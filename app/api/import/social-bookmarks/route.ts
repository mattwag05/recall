import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { generatePostIdFromUrl } from '@/lib/url-capture'

export const runtime = 'nodejs'

const MAX_IMPORT_BYTES = 25 * 1024 * 1024
const MAX_IMPORT_ITEMS = 1000
const DEFAULT_CATEGORY_COLOR = '#6b7280'

type ImportCard = {
  id: string
  title: string
  status: 'organizing' | 'summarizing' | 'ready' | 'failed'
  extracted: boolean
  skipped?: boolean
  message?: string
}

type ImportFailure = {
  name: string
  error: string
  status: number
}

type NormalizedSocialBookmark = {
  postId: string
  originalPostId: string | null
  platform: string
  title: string
  text: string
  body: string | null
  postUrl: string
  provider: string | null
  authorHandle: string | null
  authorName: string | null
  postCreatedAt: Date | null
  importedAt: Date | null
  saveAction: string
  sourceType: string
  semanticTags: string[]
  entities: Record<string, unknown> | null
  actionability: string | null
  notes: string | null
  categories: Array<{ name: string; slug: string; color: string; confidence: number }>
  mediaItems: Array<{ type: string; url: string; thumbnailUrl: string | null }>
  thumbnail: string | null
  raw: Record<string, unknown>
}

class SocialBookmarksImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Failed to parse form data' }, { status: 400 })
  }

  const files = formData.getAll('files').filter((file): file is File => file instanceof File)
  if (files.length !== 1) {
    return NextResponse.json({
      error: 'Choose one Social Bookmarks Triage JSON export.',
      failures: [{ name: 'Social Bookmarks JSON', error: 'Import one JSON file at a time.', status: 400 }],
    }, { status: 400 })
  }

  const file = files[0]
  if (!isJsonFile(file)) {
    return NextResponse.json({
      error: 'Social Bookmarks Triage imports must be JSON files.',
      failures: [{ name: file.name || 'upload', error: 'Choose a .json export or bookmarklet file.', status: 400 }],
    }, { status: 400 })
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json({
      error: 'Social Bookmarks Triage JSON is too large.',
      failures: [{ name: file.name || 'upload', error: 'Maximum import size is 25 MB.', status: 413 }],
    }, { status: 413 })
  }

  const cards: ImportCard[] = []
  const failures: ImportFailure[] = []
  let imported = 0
  let skipped = 0

  try {
    const raw = await parseJsonFile(file)
    const rawItems = extractRawItems(raw)
    if (rawItems.length === 0) {
      throw new SocialBookmarksImportError('No Social Bookmarks Triage items were found in that JSON file.')
    }

    const items = rawItems.slice(0, MAX_IMPORT_ITEMS)
    if (rawItems.length > MAX_IMPORT_ITEMS) {
      failures.push({
        name: file.name || 'Social Bookmarks JSON',
        error: `Only the first ${MAX_IMPORT_ITEMS} items were imported. Split larger exports into smaller files.`,
        status: 413,
      })
    }

    const prisma = getPrisma()
    const seen = new Set<string>()

    for (let index = 0; index < items.length; index += 1) {
      const rawItem = items[index]
      const label = itemLabel(rawItem, index)
      try {
        const item = normalizeSocialBookmark(rawItem)
        const duplicateKey = item.postUrl || item.postId
        if (seen.has(duplicateKey)) {
          skipped += 1
          cards.push({
            id: item.postId,
            title: item.title,
            status: 'ready',
            extracted: true,
            skipped: true,
            message: 'Duplicate inside this Social Bookmarks export',
          })
          continue
        }
        seen.add(duplicateKey)

        const existing = await prisma.bookmark.findFirst({
          where: {
            OR: [
              { postId: item.postId },
              ...(item.postUrl ? [{ postUrl: item.postUrl }, { postId: generatePostIdFromUrl(item.postUrl) }] : []),
            ],
          },
          select: { id: true, title: true, text: true, status: true },
        })
        if (existing) {
          skipped += 1
          cards.push({
            id: existing.id,
            title: existing.title ?? existing.text.slice(0, 120),
            status: isImportStatus(existing.status) ? existing.status : 'ready',
            extracted: true,
            skipped: true,
            message: 'Already in library',
          })
          continue
        }

        const categoryRows = []
        for (const category of item.categories) {
          categoryRows.push(await ensureCategory(category))
        }

        const bookmark = await prisma.bookmark.create({
          data: {
            postId: item.postId,
            platform: item.platform,
            title: item.title,
            provider: item.provider,
            thumbnail: item.thumbnail,
            text: item.text,
            body: item.body,
            postUrl: item.postUrl,
            authorHandle: item.authorHandle,
            authorName: item.authorName,
            postCreatedAt: item.postCreatedAt,
            importedAt: item.importedAt ?? new Date(),
            rawJson: JSON.stringify({
              captureMode: 'social-bookmarks-import',
              originalPostId: item.originalPostId,
              platform: item.platform,
              sourceType: item.sourceType,
              saveAction: item.saveAction,
              actionability: item.actionability,
              semanticTags: item.semanticTags,
              categories: item.categories,
              importedFrom: 'social-bookmarks-triage',
              raw: item.raw,
            }),
            semanticTags: item.semanticTags.length > 0 ? JSON.stringify(item.semanticTags) : null,
            entities: item.entities ? JSON.stringify(item.entities) : null,
            actionability: item.actionability,
            saveAction: item.saveAction,
            sourceType: item.sourceType,
            status: 'organizing',
            notes: item.notes,
            mediaItems: item.mediaItems.length > 0 ? {
              create: item.mediaItems.map(media => ({
                type: media.type,
                url: media.url,
                thumbnailUrl: media.thumbnailUrl,
              })),
            } : undefined,
            categories: categoryRows.length > 0 ? {
              create: categoryRows.map(({ category, confidence }) => ({
                categoryId: category.id,
                confidence,
              })),
            } : undefined,
          },
        })

        try {
          indexBookmark({
            bookmarkId: bookmark.id,
            title: item.title,
            text: item.text,
            body: item.body,
            semanticTags: JSON.stringify(item.semanticTags),
            entities: item.entities ? JSON.stringify(item.entities) : undefined,
            categories: item.categories.map(category => category.name).join(' '),
          })
        } catch {
          // Non-fatal; FTS rebuild can recover.
        }

        imported += 1
        cards.push({
          id: bookmark.id,
          title: item.title,
          status: 'organizing',
          extracted: true,
        })
      } catch (err) {
        failures.push({
          name: label,
          error: err instanceof Error ? err.message : String(err),
          status: err instanceof SocialBookmarksImportError ? err.status : 500,
        })
      }
    }
  } catch (err) {
    const failure = {
      name: file.name || 'Social Bookmarks JSON',
      error: err instanceof Error ? err.message : String(err),
      status: err instanceof SocialBookmarksImportError ? err.status : 400,
    }
    return NextResponse.json({ error: failure.error, failures: [failure] }, { status: failure.status })
  }

  if (cards.length === 0) {
    return NextResponse.json({
      error: 'No Social Bookmarks Triage items were imported.',
      failures,
    }, { status: failures.length > 0 ? 400 : 422 })
  }

  return NextResponse.json({
    ok: true,
    cards,
    failures,
    imported,
    skipped,
    failed: failures.length,
  })
}

async function parseJsonFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text())
  } catch {
    throw new SocialBookmarksImportError('File is not valid JSON.')
  }
}

function extractRawItems(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord)
  if (!isRecord(raw)) return []
  for (const key of ['bookmarks', 'items', 'data', 'posts']) {
    const value = raw[key]
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

function normalizeSocialBookmark(raw: Record<string, unknown>): NormalizedSocialBookmark {
  const originalPostId = stringValue(raw.postId) || stringValue(raw.id)
  const platform = normalizePlatform(stringValue(raw.platform))
  const rawUrl = stringValue(raw.postUrl) || stringValue(raw.url) || ''
  const postUrl = normalizeUrl(rawUrl)
  const text = cleanText(stringValue(raw.text) || stringValue(raw.description) || stringValue(raw.title))
  const body = cleanText(stringValue(raw.body) || stringValue(raw.readerContent) || text) || null
  const authorHandle = cleanHandle(stringValue(raw.authorHandle) || stringValue(raw.author))
  const authorName = cleanText(stringValue(raw.authorName))
  const title = cleanText(stringValue(raw.title)) || titleFromSocialPost({ text, authorHandle, authorName, platform, postUrl })

  if (!text && !body && !postUrl) {
    throw new SocialBookmarksImportError('Item is missing text, body, and URL.')
  }

  const postId = socialPostId(platform, originalPostId, postUrl, text)
  const semanticTags = stringArray(raw.semanticTags)
  const categories = categoryArray(raw.categories)
  const mediaItems = mediaArray(raw.mediaItems ?? raw.media)
  const firstThumbnail = mediaItems.find(media => media.thumbnailUrl)?.thumbnailUrl ?? mediaItems[0]?.url ?? null

  return {
    postId,
    originalPostId,
    platform,
    title,
    text: text || title,
    body,
    postUrl,
    provider: providerFromUrl(postUrl) || platform,
    authorHandle,
    authorName,
    postCreatedAt: dateValue(raw.postCreatedAt),
    importedAt: dateValue(raw.importedAt),
    saveAction: normalizeSaveAction(stringValue(raw.saveAction) || stringValue(raw.source)),
    sourceType: normalizeSourceType(stringValue(raw.sourceType), platform),
    semanticTags,
    entities: objectValue(raw.entities),
    actionability: normalizeActionability(stringValue(raw.actionability)),
    notes: cleanText(stringValue(raw.notes)) || null,
    categories,
    mediaItems,
    thumbnail: firstThumbnail,
    raw,
  }
}

function isJsonFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'json' || file.type === 'application/json' || file.type === 'application/octet-stream'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanText(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim()
}

function cleanHandle(value: string): string | null {
  const handle = value.trim()
  if (!handle) return null
  return handle.startsWith('@') ? handle : `@${handle}`
}

function normalizeUrl(value: string): string {
  if (!value) return ''
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new SocialBookmarksImportError('Post URL is malformed.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SocialBookmarksImportError('Only http and https Social Bookmarks links can be imported.')
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new SocialBookmarksImportError('Recall blocks localhost, private network, and internal IP links for local safety.')
  }
  return parsed.href
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '0.0.0.0' || host === '169.254.169.254') return true
  if (host.includes(':') && (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) {
    return true
  }

  const octets = host.split('.')
  if (octets.length !== 4 || octets.some(part => !/^\d+$/.test(part))) return false
  const parts = octets.map(part => Number.parseInt(part, 10))
  if (parts.some(part => part < 0 || part > 255)) return false
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function normalizePlatform(value: string): string {
  const platform = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
  return platform || 'web'
}

function normalizeSaveAction(value: string): string {
  return value === 'liked' ? 'liked' : 'saved'
}

function normalizeSourceType(value: string, platform: string): string {
  const sourceType = value.toLowerCase()
  if (['social', 'url', 'pasted', 'document', 'media', 'image'].includes(sourceType)) return sourceType
  return ['threads', 'instagram', 'reddit'].includes(platform) ? 'social' : 'url'
}

function normalizeActionability(value: string): string | null {
  const actionability = value.toLowerCase()
  return ['inspiration', 'try_this', 'build_this', 'reference'].includes(actionability) ? actionability : null
}

function stringArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? parseJson(value) : value
  if (!Array.isArray(parsed)) return []
  return Array.from(new Set(parsed.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean))).slice(0, 50)
}

function objectValue(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === 'string' ? parseJson(value) : value
  return isRecord(parsed) ? parsed : null
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function categoryArray(value: unknown): Array<{ name: string; slug: string; color: string; confidence: number }> {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const categories: Array<{ name: string; slug: string; color: string; confidence: number }> = []

  for (const raw of value) {
    const category = normalizeCategory(raw)
    if (!category || seen.has(category.slug)) continue
    seen.add(category.slug)
    categories.push(category)
  }

  return categories.slice(0, 25)
}

function normalizeCategory(raw: unknown): { name: string; slug: string; color: string; confidence: number } | null {
  if (typeof raw === 'string') {
    const name = cleanText(raw)
    if (!name) return null
    return { name, slug: slugify(name), color: DEFAULT_CATEGORY_COLOR, confidence: 0.8 }
  }
  if (!isRecord(raw)) return null
  const name = cleanText(stringValue(raw.name) || stringValue(raw.slug))
  if (!name) return null
  return {
    name,
    slug: slugify(stringValue(raw.slug) || name),
    color: stringValue(raw.color) || DEFAULT_CATEGORY_COLOR,
    confidence: numberValue(raw.confidence, 0.8),
  }
}

function mediaArray(value: unknown): Array<{ type: string; url: string; thumbnailUrl: string | null }> {
  if (!Array.isArray(value)) return []
  const media: Array<{ type: string; url: string; thumbnailUrl: string | null }> = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const type = normalizeMediaType(stringValue(raw.type))
    const url = stringValue(raw.url)
    if (!type || !url) continue
    media.push({
      type,
      url,
      thumbnailUrl: stringValue(raw.thumbnailUrl) || null,
    })
  }
  return media.slice(0, 20)
}

function normalizeMediaType(value: string): string | null {
  if (['image', 'video', 'carousel', 'audio'].includes(value)) return value
  return null
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function titleFromSocialPost({
  text,
  authorHandle,
  authorName,
  platform,
  postUrl,
}: {
  text: string
  authorHandle: string | null
  authorName: string | null
  platform: string
  postUrl: string
}): string {
  const excerpt = text.split(/\s+/).slice(0, 10).join(' ').trim()
  if (excerpt) return excerpt.length > 90 ? `${excerpt.slice(0, 87)}...` : excerpt
  const author = authorName || authorHandle
  if (author) return `${author} on ${platform}`
  return providerFromUrl(postUrl) || 'Social bookmark'
}

function providerFromUrl(url: string): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function socialPostId(platform: string, originalPostId: string | null, postUrl: string, text: string): string {
  if (originalPostId) return `sbt:${hashStable(`${platform}:${originalPostId}`)}`
  if (postUrl) return `sbt:${generatePostIdFromUrl(postUrl)}`
  return `sbt:${hashStable(`${platform}:${text}`)}`
}

function hashStable(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'social-bookmarks'
}

async function ensureCategory(input: { name: string; slug: string; color: string; confidence: number }) {
  const prisma = getPrisma()
  const existing = await prisma.category.findFirst({
    where: { OR: [{ slug: input.slug }, { name: input.name }] },
    select: { id: true },
  })
  if (existing) return { category: existing, confidence: input.confidence }

  const category = await prisma.category.create({
    data: {
      name: input.name,
      slug: input.slug,
      color: input.color,
      description: 'Imported from Social Bookmarks Triage.',
      isAiGenerated: false,
    },
    select: { id: true },
  })
  return { category, confidence: input.confidence }
}

function itemLabel(item: Record<string, unknown>, index: number): string {
  return stringValue(item.title) ||
    stringValue(item.text).slice(0, 80) ||
    stringValue(item.postUrl) ||
    stringValue(item.url) ||
    `item ${index + 1}`
}

function isImportStatus(value: string): value is ImportCard['status'] {
  return value === 'organizing' || value === 'summarizing' || value === 'ready' || value === 'failed'
}
