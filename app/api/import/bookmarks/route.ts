import { JSDOM } from 'jsdom'
import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { generateLegacyPostIdFromUrl, generatePostIdFromUrl } from '@/lib/url-capture'

export const runtime = 'nodejs'

const MAX_BOOKMARK_IMPORT_FILES = 1
const MAX_BOOKMARK_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_BOOKMARKS_PER_IMPORT = 250

type BrowserBookmark = {
  title: string
  url: string
  folderPath: string[]
  addDate: string | null
}

type BookmarkImportCard = {
  id: string
  title: string
  status: string
  extracted: boolean
  skipped?: boolean
  message?: string
}

type BookmarkImportFailure = {
  name: string
  error: string
  status: number
}

class BookmarkImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'Choose a browser bookmarks HTML export before importing.' }, { status: 400 })
    }
    if (files.length > MAX_BOOKMARK_IMPORT_FILES) {
      return NextResponse.json({ error: 'Import one browser bookmarks export at a time.' }, { status: 400 })
    }

    const file = files[0]
    const name = file.name || 'bookmarks.html'
    if (!isBookmarkHtmlFile(file, name)) {
      return NextResponse.json({ error: `${name} must be a browser bookmarks HTML export.` }, { status: 400 })
    }
    if (file.size > MAX_BOOKMARK_IMPORT_BYTES) {
      return NextResponse.json({ error: `${name} is larger than 5 MB.` }, { status: 400 })
    }

    const html = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(await file.arrayBuffer()))
    const parsed = parseBrowserBookmarks(html)
    if (parsed.length === 0) {
      return NextResponse.json({ error: `${name} did not contain any http(s) bookmarks.` }, { status: 400 })
    }

    const deduped = uniqueBookmarks(parsed)
    const limited = deduped.slice(0, MAX_BOOKMARKS_PER_IMPORT)
    const overflow = Math.max(deduped.length - limited.length, 0)
    const prisma = getPrisma()
    const cards: BookmarkImportCard[] = []
    const failures: BookmarkImportFailure[] = []

    for (const bookmark of limited) {
      try {
        const validation = validatePublicHttpUrl(bookmark.url)
        if ('error' in validation) {
          throw new BookmarkImportError(`${bookmark.title}: ${validation.error}`, 400)
        }
        const url = validation.url.href
        const postId = generatePostIdFromUrl(url)
        const legacyPostId = generateLegacyPostIdFromUrl(url)
        const existing = await prisma.bookmark.findFirst({
          where: {
            OR: [
              { postUrl: url },
              { postUrl: bookmark.url },
              { postId },
              { postId: legacyPostId },
            ],
          },
          select: { id: true, title: true, text: true, status: true },
        })
        if (existing) {
          cards.push({
            id: existing.id,
            title: cardTitle(existing.title, existing.text),
            status: existing.status,
            extracted: existing.status !== 'failed',
            skipped: true,
            message: `${bookmark.title} is already in your library.`,
          })
          continue
        }

        const hostname = validation.url.hostname.replace(/^www\./, '')
        const text = bookmark.folderPath.length > 0
          ? `${bookmark.title} bookmarked from ${bookmark.folderPath.join(' / ')}.`
          : `${bookmark.title} bookmarked from browser bookmarks.`
        const createdAt = dateFromBookmark(bookmark.addDate)
        const created = await prisma.bookmark.create({
          data: {
            postId,
            platform: 'web',
            title: bookmark.title,
            provider: hostname,
            text,
            body: null,
            postUrl: url,
            sourceType: 'url',
            saveAction: 'saved',
            status: 'organizing',
            postCreatedAt: createdAt,
            rawJson: JSON.stringify({
              postId,
              url,
              title: bookmark.title,
              provider: hostname,
              captureMode: 'browser-bookmarks-import',
              folderPath: bookmark.folderPath,
              addDate: bookmark.addDate,
              extraction: 'metadata-only',
            }),
          },
        })

        try {
          indexBookmark({
            bookmarkId: created.id,
            title: bookmark.title,
            text: `${text} ${url} ${bookmark.folderPath.join(' ')}`,
            body: null,
          })
        } catch {}

        cards.push({
          id: created.id,
          title: bookmark.title,
          status: created.status,
          extracted: false,
          message: 'Imported from browser bookmarks; open the card to retry article extraction if needed.',
        })
      } catch (err) {
        failures.push({
          name: bookmark.title,
          error: err instanceof Error ? err.message : `Could not import ${bookmark.title}.`,
          status: err instanceof BookmarkImportError ? err.status : 500,
        })
      }
    }

    if (overflow > 0) {
      failures.push({
        name,
        error: `Only the first ${MAX_BOOKMARKS_PER_IMPORT} bookmarks were imported from this export.`,
        status: 400,
      })
    }

    if (cards.length === 0) {
      return NextResponse.json({
        ok: false,
        error: failures[0]?.error ?? 'No browser bookmarks could be imported.',
        failures,
      }, { status: failures[0]?.status ?? 400 })
    }

    return NextResponse.json({
      ok: true,
      cards,
      failures,
      imported: cards.filter(card => !card.skipped).length,
      skipped: cards.filter(card => card.skipped).length,
      failed: failures.length,
    })
  } catch (err) {
    return NextResponse.json({ error: `Browser bookmarks import failed: ${String(err)}` }, { status: 500 })
  }
}

function parseBrowserBookmarks(html: string): BrowserBookmark[] {
  const folderStack: string[] = []
  let pendingFolder: string | null = null
  const bookmarks: BrowserBookmark[] = []

  for (const rawLine of html.split(/\r?\n/)) {
    const line = rawLine.trim()
    const folderMatch = line.match(/<H3\b[^>]*>([\s\S]*?)<\/H3>/i)
    if (folderMatch) {
      pendingFolder = decodeHtml(folderMatch[1]).trim()
      continue
    }

    if (/<DL\b/i.test(line)) {
      if (pendingFolder) {
        folderStack.push(pendingFolder)
        pendingFolder = null
      }
      continue
    }

    if (/<\/DL>/i.test(line)) {
      folderStack.pop()
      pendingFolder = null
      continue
    }

    const linkMatch = line.match(/<A\b([^>]*)>([\s\S]*?)<\/A>/i)
    if (!linkMatch) continue
    const href = attr(linkMatch[1], 'HREF')
    if (!href) continue
    const title = decodeHtml(linkMatch[2]).replace(/\s+/g, ' ').trim() || href
    const addDate = attr(linkMatch[1], 'ADD_DATE')
    bookmarks.push({
      title: title.slice(0, 220),
      url: decodeHtml(href).trim(),
      folderPath: [...folderStack],
      addDate,
    })
  }

  return bookmarks.filter(bookmark => {
    try {
      const url = new URL(bookmark.url)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  })
}

function uniqueBookmarks(bookmarks: BrowserBookmark[]): BrowserBookmark[] {
  const seen = new Set<string>()
  return bookmarks.flatMap(bookmark => {
    const normalized = normalizeUrlKey(bookmark.url)
    if (!normalized || seen.has(normalized)) return []
    seen.add(normalized)
    return [bookmark]
  })
}

function normalizeUrlKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function attr(attributes: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = attributes.match(pattern)
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null
}

function decodeHtml(value: string): string {
  return new JSDOM(`<!doctype html><body>${value}</body>`).window.document.body.textContent ?? value
}

function isBookmarkHtmlFile(file: File, filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'html' ||
    extension === 'htm' ||
    file.type === 'text/html' ||
    file.type === 'application/octet-stream'
}

function validatePublicHttpUrl(rawUrl: string): { url: URL; error?: never } | { url?: never; error: string } {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Only http and https bookmarks can be imported.' }
    }
    if (isPrivateHostname(parsed.hostname)) {
      return { error: 'Recall blocks localhost, private network, and internal IP bookmarks for local safety.' }
    }
    return { url: parsed }
  } catch {
    return { error: 'Bookmark URL is malformed.' }
  }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '0.0.0.0' || host === '169.254.169.254') return true
  if (host.includes(':') && (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) return true

  const octets = host.split('.')
  if (octets.length !== 4 || octets.some(p => !/^\d+$/.test(p))) return false
  const parts = octets.map(p => Number.parseInt(p, 10))
  if (parts.some(n => n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function dateFromBookmark(addDate: string | null): Date {
  if (!addDate) return new Date()
  const seconds = Number.parseInt(addDate, 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date()
  return new Date(seconds * 1000)
}

function cardTitle(title: string | null, text: string): string {
  return title || text.slice(0, 120) || 'Bookmark'
}
