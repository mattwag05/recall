import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { captureUrl, generateLegacyPostIdFromUrl, generatePostIdFromUrl } from '@/lib/url-capture'
import { apiError } from '@/lib/api-errors'
import { isPrivateHostname } from '@/lib/url-safety'

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
    return apiError('Could not import URL', err, 500)
  }
}
