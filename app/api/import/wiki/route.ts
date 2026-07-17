import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { captureWikipediaTopic, searchWikipediaTopics } from '@/lib/wiki-capture'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query')?.trim() ?? ''
  if (!query) return NextResponse.json({ error: 'Enter a Wikipedia topic to search.' }, { status: 400 })

  try {
    const results = await searchWikipediaTopics(query, 6)
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    return NextResponse.json({ error: `Could not search Wikipedia: ${String(err)}` }, { status: 502 })
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).title !== 'string') {
    return NextResponse.json({ error: 'Choose a Wikipedia topic before importing.' }, { status: 400 })
  }

  const title = (body as { title: string }).title.trim()
  if (!title) return NextResponse.json({ error: 'Choose a Wikipedia topic before importing.' }, { status: 400 })

  try {
    const capture = await captureWikipediaTopic(title)
    const prisma = getPrisma()
    const existing = await prisma.bookmark.findFirst({
      where: {
        OR: [
          { postId: capture.postId },
          { postUrl: capture.url },
        ],
      },
      select: { id: true, title: true, status: true },
    })

    if (existing) {
      return NextResponse.json({
        bookmarkId: existing.id,
        title: existing.title ?? capture.title,
        status: existing.status,
        skipped: true,
        extracted: true,
        message: 'Already in library',
      })
    }

    const bookmark = await prisma.bookmark.create({
      data: {
        postId: capture.postId,
        platform: 'wikipedia',
        title: capture.title,
        provider: 'wikipedia.org',
        thumbnail: capture.thumbnail,
        text: capture.text,
        body: capture.body,
        postUrl: capture.url,
        sourceType: 'wiki',
        saveAction: 'saved',
        status: 'organizing',
        postCreatedAt: new Date(),
        rawJson: JSON.stringify(capture.rawJson),
        mediaItems: capture.thumbnail ? { create: [{ type: 'image', url: capture.thumbnail }] } : undefined,
      },
    })

    try {
      indexBookmark({
        bookmarkId: bookmark.id,
        title: capture.title,
        text: capture.text,
        body: capture.body,
      })
    } catch {}

    return NextResponse.json({
      bookmarkId: bookmark.id,
      title: capture.title,
      status: bookmark.status,
      extracted: true,
      provider: 'wikipedia.org',
      message: 'Wikipedia topic imported. Summarizing on your local model...',
    })
  } catch (err) {
    return NextResponse.json({ error: `Could not import Wikipedia topic: ${String(err)}` }, { status: 502 })
  }
}
