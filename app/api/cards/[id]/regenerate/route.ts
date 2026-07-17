import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { generateNotebook, extractTldr } from '@/lib/notebook'

export const runtime = 'nodejs'
export const maxDuration = 120

type Ctx = { params: Promise<{ id: string }> }

// POST /api/cards/:id/regenerate — rebuild the Notebook (and TL;DR summary) for one card.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const replace = body.replace === true
    const prisma = getPrisma()
    const b = await prisma.bookmark.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        text: true,
        body: true,
        status: true,
        notebookContent: true,
        semanticTags: true,
        entities: true,
      },
    })
    if (!b) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    if (!(b.body ?? b.text ?? '').trim()) {
      return NextResponse.json({ error: 'No content to summarize' }, { status: 400 })
    }
    if (b.notebookContent?.trim() && !replace) {
      return NextResponse.json({
        error: 'Regenerating replaces the current notebook. Confirm replacement before trying again.',
      }, { status: 409 })
    }

    await prisma.bookmark.update({ where: { id }, data: { status: 'summarizing' } })
    try {
      const notebookContent = await generateNotebook({ id: b.id, title: b.title, text: b.text, body: b.body })
      const tldr = extractTldr(notebookContent)

      await prisma.bookmark.update({
        where: { id },
        data: { notebookContent, status: 'ready', embedding: null, ...(tldr ? { summary: tldr } : {}) },
      })
      try {
        indexBookmark({
          bookmarkId: id,
          title: b.title,
          text: b.text,
          body: b.body,
          summary: tldr,
          notebookContent,
          semanticTags: b.semanticTags,
          entities: b.entities,
        })
      } catch {}

      return NextResponse.json({ ok: true, notebookContent, summary: tldr || undefined })
    } catch (err) {
      await prisma.bookmark.update({ where: { id }, data: { status: b.status } }).catch(() => {})
      return NextResponse.json({ error: `Could not regenerate notebook: ${String(err)}` }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ error: `Could not regenerate notebook: ${String(err)}` }, { status: 500 })
  }
}
