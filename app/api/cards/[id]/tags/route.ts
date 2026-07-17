import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmarkById } from '@/lib/fts'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
}

const PALETTE = ['#7b2d26', '#3f5b52', '#8a6d3b', '#6b7f54', '#4a5a73', '#9a5b3b', '#73506b', '#6b5d4f']

// POST /api/cards/:id/tags  { name }  — add a tag to a card (creating it if new)
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const name = ((body ?? {}) as Record<string, unknown>).name
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Tag name required' }, { status: 400 })
    }
    const slug = slugify(name)
    if (!slug) return NextResponse.json({ error: 'Invalid tag name' }, { status: 400 })

    const prisma = getPrisma()
    const card = await prisma.bookmark.findUnique({ where: { id }, select: { id: true } })
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    // Find or create the tag (manual tags are user-created, isAiGenerated stays false).
    let category = await prisma.category.findUnique({ where: { slug } })
    if (!category) {
      const count = await prisma.category.count()
      category = await prisma.category.create({
        data: { name: name.trim(), slug, color: PALETTE[count % PALETTE.length], isAiGenerated: false },
      })
    }

    await prisma.bookmarkCategory.upsert({
      where: { bookmarkId_categoryId: { bookmarkId: id, categoryId: category.id } },
      create: { bookmarkId: id, categoryId: category.id, confidence: 1.0 },
      update: { confidence: 1.0 },
    })
    await prisma.bookmark.update({ where: { id }, data: { embedding: null } })
    try { indexBookmarkById(id) } catch {}

    return NextResponse.json({ ok: true, tag: { name: category.name, slug: category.slug, color: category.color } })
  } catch (err) {
    return NextResponse.json({ error: `Could not add tag: ${String(err)}` }, { status: 500 })
  }
}

// DELETE /api/cards/:id/tags?slug=...  — remove a tag from a card
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const slug = new URL(request.url).searchParams.get('slug')
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

    const prisma = getPrisma()
    const card = await prisma.bookmark.findUnique({ where: { id }, select: { id: true } })
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const category = await prisma.category.findUnique({ where: { slug }, select: { id: true } })
    if (!category) return NextResponse.json({ ok: true })

    try {
      await prisma.bookmarkCategory.delete({
        where: { bookmarkId_categoryId: { bookmarkId: id, categoryId: category.id } },
      })
      await prisma.bookmark.update({ where: { id }, data: { embedding: null } })
    } catch (err) {
      if (!isPrismaNotFound(err)) throw err
      // already not linked — fine
    }
    try { indexBookmarkById(id) } catch {}
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: `Could not remove tag: ${String(err)}` }, { status: 500 })
  }
}

function isPrismaNotFound(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2025'
  )
}
