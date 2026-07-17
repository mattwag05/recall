import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'

export const runtime = 'nodejs'

// POST /api/cards/note  { title?, text }
// Creates a note card from pasted text. Status starts "organizing" so the
// enrichment pass will give it a notebook + tags.
export async function POST(request: Request) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const obj = (body ?? {}) as Record<string, unknown>
    const text = typeof obj.text === 'string' ? obj.text.trim() : ''
    const title = typeof obj.title === 'string' ? obj.title.trim() : ''
    if (!text && !title) {
      return NextResponse.json({ error: 'A note needs a title or some text' }, { status: 400 })
    }

    const prisma = getPrisma()
    const derivedTitle = title || text.split('\n')[0].slice(0, 120) || 'Note'

    const card = await prisma.bookmark.create({
      data: {
        platform: 'web',
        title: derivedTitle,
        provider: 'note',
        text: text.slice(0, 280) || derivedTitle,
        body: text || null,
        postUrl: '',
        sourceType: 'pasted',
        saveAction: 'saved',
        status: text.trim().length > 0 ? 'organizing' : 'ready',
        postCreatedAt: new Date(),
      },
    })

    try {
      indexBookmark({
        bookmarkId: card.id,
        title: derivedTitle,
        text,
        body: text,
      })
    } catch {}

    return NextResponse.json({ id: card.id, title: derivedTitle, status: card.status })
  } catch (err) {
    return NextResponse.json({ error: `Could not create note card: ${String(err)}` }, { status: 500 })
  }
}
