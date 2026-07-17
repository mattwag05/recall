import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { generateLegacyPostIdFromUrl, generatePostIdFromUrl } from '@/lib/url-capture'

export const runtime = 'nodejs'

const MAX_POCKET_IMPORT_FILES = 1
const MAX_POCKET_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_POCKET_ITEMS_PER_IMPORT = 250

type PocketItem = {
  title: string
  url: string
  tags: string[]
  timeAdded: string | null
  state: string | null
}

type PocketImportCard = {
  id: string
  title: string
  status: string
  extracted: boolean
  skipped?: boolean
  message?: string
}

type PocketImportFailure = {
  name: string
  error: string
  status: number
}

class PocketImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'Choose a Pocket CSV export before importing.' }, { status: 400 })
    }
    if (files.length > MAX_POCKET_IMPORT_FILES) {
      return NextResponse.json({ error: 'Import one Pocket CSV export at a time.' }, { status: 400 })
    }

    const file = files[0]
    const name = file.name || 'pocket.csv'
    if (!isPocketCsvFile(file, name)) {
      return NextResponse.json({ error: `${name} must be a Pocket CSV export.` }, { status: 400 })
    }
    if (file.size > MAX_POCKET_IMPORT_BYTES) {
      return NextResponse.json({ error: `${name} is larger than 5 MB.` }, { status: 400 })
    }

    const csv = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(await file.arrayBuffer())).replace(/^\uFEFF/, '')
    const parsed = parsePocketCsv(csv)
    if (parsed.length === 0) {
      return NextResponse.json({ error: `${name} did not contain any http(s) Pocket links.` }, { status: 400 })
    }

    const deduped = uniquePocketItems(parsed)
    const limited = deduped.slice(0, MAX_POCKET_ITEMS_PER_IMPORT)
    const overflow = Math.max(deduped.length - limited.length, 0)
    const prisma = getPrisma()
    const cards: PocketImportCard[] = []
    const failures: PocketImportFailure[] = []

    for (const item of limited) {
      try {
        const validation = validatePublicHttpUrl(item.url)
        if ('error' in validation) {
          throw new PocketImportError(`${item.title}: ${validation.error}`, 400)
        }
        const url = validation.url.href
        const postId = generatePostIdFromUrl(url)
        const legacyPostId = generateLegacyPostIdFromUrl(url)
        const existing = await prisma.bookmark.findFirst({
          where: {
            OR: [
              { postUrl: url },
              { postUrl: item.url },
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
            message: `${item.title} is already in your library.`,
          })
          continue
        }

        const hostname = validation.url.hostname.replace(/^www\./, '')
        const tagText = item.tags.length > 0 ? ` Pocket tags: ${item.tags.join(', ')}.` : ''
        const stateText = item.state ? ` Pocket state: ${item.state}.` : ''
        const text = `${item.title} saved from Pocket.${tagText}${stateText}`
        const created = await prisma.bookmark.create({
          data: {
            postId,
            platform: 'pocket',
            title: item.title,
            provider: hostname,
            text,
            body: null,
            postUrl: url,
            sourceType: 'url',
            saveAction: 'saved',
            status: 'organizing',
            postCreatedAt: dateFromPocket(item.timeAdded),
            rawJson: JSON.stringify({
              postId,
              url,
              title: item.title,
              provider: hostname,
              captureMode: 'pocket-import',
              pocketTags: item.tags,
              pocketState: item.state,
              timeAdded: item.timeAdded,
              extraction: 'metadata-only',
            }),
          },
        })

        try {
          indexBookmark({
            bookmarkId: created.id,
            title: item.title,
            text: `${text} ${url} ${item.tags.join(' ')}`,
            body: null,
          })
        } catch {}

        cards.push({
          id: created.id,
          title: item.title,
          status: created.status,
          extracted: false,
          message: 'Imported from Pocket; open the card to retry article extraction if needed.',
        })
      } catch (err) {
        failures.push({
          name: item.title,
          error: err instanceof Error ? err.message : `Could not import ${item.title}.`,
          status: err instanceof PocketImportError ? err.status : 500,
        })
      }
    }

    if (overflow > 0) {
      failures.push({
        name,
        error: `Only the first ${MAX_POCKET_ITEMS_PER_IMPORT} Pocket links were imported from this export.`,
        status: 400,
      })
    }

    if (cards.length === 0) {
      return NextResponse.json({
        ok: false,
        error: failures[0]?.error ?? 'No Pocket links could be imported.',
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
    return NextResponse.json({ error: `Pocket import failed: ${String(err)}` }, { status: 500 })
  }
}

function parsePocketCsv(csv: string): PocketItem[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const headers = rows[0].map(header => normalizeHeader(header))
  const urlIndex = findHeaderIndex(headers, ['url', 'link', 'given_url', 'resolved_url'])
  if (urlIndex < 0) return []
  const titleIndex = findHeaderIndex(headers, ['title', 'given_title', 'resolved_title', 'excerpt'])
  const tagIndex = findHeaderIndex(headers, ['tags', 'tag'])
  const timeIndex = findHeaderIndex(headers, ['time_added', 'time added', 'added', 'created_at', 'created'])
  const stateIndex = findHeaderIndex(headers, ['status', 'state', 'favorite', 'archive'])

  return rows.slice(1).flatMap(row => {
    const rawUrl = cell(row, urlIndex)
    if (!rawUrl) return []
    let parsedUrl: URL
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      return []
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return []
    const rawTitle = titleIndex >= 0 ? cell(row, titleIndex) : ''
    const title = (rawTitle || parsedUrl.hostname.replace(/^www\./, '') || rawUrl).replace(/\s+/g, ' ').trim().slice(0, 220)
    return [{
      title,
      url: rawUrl.trim(),
      tags: parsePocketTags(tagIndex >= 0 ? cell(row, tagIndex) : ''),
      timeAdded: timeIndex >= 0 ? cell(row, timeIndex) || null : null,
      state: stateIndex >= 0 ? cell(row, stateIndex) || null : null,
    }]
  })
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]
    const next = csv[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  row.push(field)
  rows.push(row)
  return rows.filter(csvRow => csvRow.some(value => value.trim().length > 0))
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex(header => candidates.includes(header))
}

function cell(row: string[], index: number): string {
  return (row[index] ?? '').trim()
}

function parsePocketTags(value: string): string[] {
  if (!value.trim()) return []
  const seen = new Set<string>()
  return value
    .split(/[|;,]/)
    .map(tag => tag.replace(/^#/, '').trim())
    .filter(Boolean)
    .flatMap(tag => {
      const normalized = tag.toLowerCase()
      if (seen.has(normalized)) return []
      seen.add(normalized)
      return [tag.slice(0, 80)]
    })
    .slice(0, 30)
}

function uniquePocketItems(items: PocketItem[]): PocketItem[] {
  const seen = new Set<string>()
  return items.flatMap(item => {
    const normalized = normalizeUrlKey(item.url)
    if (!normalized || seen.has(normalized)) return []
    seen.add(normalized)
    return [item]
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

function isPocketCsvFile(file: File, filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'csv' ||
    file.type === 'text/csv' ||
    file.type === 'application/csv' ||
    file.type === 'application/vnd.ms-excel' ||
    file.type === 'application/octet-stream'
}

function validatePublicHttpUrl(rawUrl: string): { url: URL; error?: never } | { url?: never; error: string } {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Only http and https Pocket links can be imported.' }
    }
    if (isPrivateHostname(parsed.hostname)) {
      return { error: 'Recall blocks localhost, private network, and internal IP links for local safety.' }
    }
    return { url: parsed }
  } catch {
    return { error: 'Pocket URL is malformed.' }
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

function dateFromPocket(value: string | null): Date {
  if (!value) return new Date()
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number.parseInt(trimmed, 10)
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000
    const date = new Date(millis)
    if (!Number.isNaN(date.getTime())) return date
  }
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function cardTitle(title: string | null, text: string): string {
  return title || text.slice(0, 120) || 'Pocket link'
}
