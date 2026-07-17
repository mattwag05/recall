import { NextResponse } from 'next/server'
import { addNotebookWikiLinks } from '@/lib/connections'
import { getPrisma } from '@/lib/db'
import { indexBookmark, removeFromFts } from '@/lib/fts'
import { readTimeMinutes } from '@/lib/extract/article'
import { deleteMediaFile } from '@/lib/media-storage'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2025'
}

function internalError(message: string, err: unknown) {
  return NextResponse.json({ error: `${message}: ${String(err)}` }, { status: 500 })
}

function parseSemanticTags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

function parseQuestionOptions(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((option): option is string => typeof option === 'string') : []
  } catch {
    return []
  }
}

// GET /api/cards/:id — full card with reader + notebook content
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const prisma = getPrisma()
    const b = await prisma.bookmark.findUnique({
      where: { id },
      include: {
        categories: { select: { category: { select: { name: true, slug: true, color: true } } } },
        connectionsOut: {
          select: {
            id: true,
            entityType: true,
            label: true,
            origin: true,
            createdAt: true,
            from: { select: { id: true, title: true, text: true, provider: true, postUrl: true } },
            to: { select: { id: true, title: true, text: true, provider: true, postUrl: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        connectionsIn: {
          select: {
            id: true,
            entityType: true,
            label: true,
            origin: true,
            createdAt: true,
            from: { select: { id: true, title: true, text: true, provider: true, postUrl: true } },
            to: { select: { id: true, title: true, text: true, provider: true, postUrl: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        quizQuestions: {
          select: {
            id: true,
            prompt: true,
            answer: true,
            type: true,
            options: true,
            origin: true,
            memoryStage: true,
            dueAt: true,
            lastReviewed: true,
            timesSeen: true,
            timesCorrect: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { quizQuestions: true } },
      },
    })
    if (!b) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const tags = parseSemanticTags(b.semanticTags)

    return NextResponse.json({
      card: {
        id: b.id,
        title: b.title || b.text.slice(0, 120) || 'Untitled',
        provider: b.provider,
        url: b.postUrl,
        thumbnail: b.thumbnail,
        sourceType: b.sourceType,
        status: b.status,
        shared: b.shared,
        shareId: b.shareId,
        summary: b.summary,
        readerContent: b.body ?? '',
        notebookContent: b.notebookContent ?? '',
        notes: b.notes ?? '',
        readTime: b.body ? readTimeMinutes(b.body) : null,
        semanticTags: tags,
        categories: b.categories.map(c => c.category),
        connections: b.connectionsOut,
        incomingConnections: b.connectionsIn,
        quizQuestions: b.quizQuestions.map(question => ({
          ...question,
          options: parseQuestionOptions(question.options),
        })),
        quizQuestionCount: b._count.quizQuestions,
        createdAt: b.importedAt,
        updatedAt: b.updatedAt,
      },
    })
  } catch (err) {
    return internalError('Could not load card', err)
  }
}

// PATCH /api/cards/:id — edit title / notebook / notes
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const obj = (body ?? {}) as Record<string, unknown>
  const data: Record<string, unknown> = {}
  if (typeof obj.title === 'string') data.title = obj.title.trim()
  if (typeof obj.notebookContent === 'string') data.notebookContent = obj.notebookContent
  if (typeof obj.notes === 'string') data.notes = obj.notes
  if ('title' in data || 'notebookContent' in data) data.embedding = null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const prisma = getPrisma()
  try {
    const updated = await prisma.bookmark.update({ where: { id }, data })
    if (typeof obj.notebookContent === 'string') {
      try { await addNotebookWikiLinks(updated.id, obj.notebookContent) } catch {}
    }
    try {
      indexBookmark({
        bookmarkId: updated.id,
        title: updated.title,
        text: updated.text,
        body: updated.body,
        summary: updated.summary,
        notebookContent: updated.notebookContent,
        semanticTags: updated.semanticTags,
        entities: updated.entities,
      })
    } catch {}
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isNotFoundError(err)) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    return internalError('Could not update card', err)
  }
}

// DELETE /api/cards/:id
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params
  const prisma = getPrisma()
  try {
    const mediaItems = await prisma.mediaItem.findMany({
      where: { bookmarkId: id, localPath: { not: null } },
      select: { localPath: true },
    })
    await prisma.bookmark.delete({ where: { id } })
    await Promise.all(mediaItems.map(item => item.localPath ? deleteMediaFile(item.localPath) : Promise.resolve()))
    try { removeFromFts(id) } catch {}
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isNotFoundError(err)) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    return internalError('Could not delete card', err)
  }
}
