import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { captureUrl, generateLegacyPostIdFromUrl, generatePostIdFromUrl } from '@/lib/url-capture'

// jsdom needs the Node runtime (not edge).
export const runtime = 'nodejs'
export const maxDuration = 300

function validateUrl(rawUrl: string): { url: URL; error?: never } | { url?: never; error: string } {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Only http and https links can be saved.' }
    }
    if (isPrivateHostname(parsed.hostname)) {
      return { error: 'Recall blocks localhost, private network, and internal IP links for local safety.' }
    }
    return { url: parsed }
  } catch {
    return { error: 'Enter a full http(s) URL, for example https://example.com/article.' }
  }
}

const EXISTING_FAILED_CAPTURE_MESSAGE =
  'Already saved — extraction still needs retry from the card detail page.'

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '0.0.0.0' || host === '169.254.169.254') return true
  if (host.includes(':') && (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) {
    return true
  }

  const octets = host.split('.')
  if (octets.length !== 4 || octets.some(p => !/^\d+$/.test(p))) return false
  const parts = octets.map(p => Number.parseInt(p, 10))
  if (parts.some(n => n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).url !== 'string') {
    return NextResponse.json({ error: 'Paste a full http(s) URL before saving.' }, { status: 400 })
  }

  const rawUrl = (body as { url: string }).url.trim()
  if (!rawUrl) {
    return NextResponse.json({ error: 'Paste a full http(s) URL before saving.' }, { status: 400 })
  }

  const validation = validateUrl(rawUrl)
  if ('error' in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }
  const url = validation.url.href

  const postId = generatePostIdFromUrl(url)
  const legacyPostId = generateLegacyPostIdFromUrl(url)
  try {
    const prisma = getPrisma()

    const existing = await prisma.bookmark.findFirst({
      where: {
        OR: [
          { postUrl: url },
          { postUrl: rawUrl },
          { postId },
          { postId: legacyPostId },
        ],
      },
      select: { id: true, title: true, text: true, status: true },
    })
    if (existing) {
      return NextResponse.json({
        bookmarkId: existing.id,
        title: existing.title ?? existing.text.slice(0, 120),
        status: existing.status,
        skipped: true,
        message: existing.status === 'failed' ? EXISTING_FAILED_CAPTURE_MESSAGE : 'Already in library',
      })
    }

    const capture = await captureUrl(url)

    const bookmark = await prisma.bookmark.create({
      data: {
        postId,
        platform: capture.platform,
        title: capture.title,
        provider: capture.provider,
        thumbnail: capture.thumbnail,
        text: capture.text,
        body: capture.body,
        postUrl: url,
        sourceType: capture.sourceType,
        saveAction: 'saved',
        status: capture.status,
        postCreatedAt: new Date(),
        rawJson: JSON.stringify(capture.rawJson),
        mediaItems: capture.mediaItem ? {
          create: [{
            type: capture.mediaItem.type,
            url: capture.mediaItem.url,
            thumbnailUrl: capture.mediaItem.thumbnailUrl,
          }],
        } : capture.thumbnail ? { create: [{ type: 'image', url: capture.thumbnail }] } : undefined,
      },
    })

    try {
      indexBookmark({
        bookmarkId: bookmark.id,
        title: capture.title,
        text: capture.text,
        body: capture.body,
      })
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      bookmarkId: bookmark.id,
      title: capture.title.slice(0, 200),
      provider: capture.provider,
      extracted: capture.extracted,
      status: bookmark.status,
      message: capture.message,
    })
  } catch (err) {
    return NextResponse.json({ error: `Could not import URL: ${String(err)}` }, { status: 500 })
  }
}
