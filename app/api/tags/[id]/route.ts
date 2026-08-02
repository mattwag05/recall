import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { apiError } from '@/lib/api-errors'
import { indexBookmarkById } from '@/lib/fts'
import { parseTagName, slugifyTag, wouldCycle } from '@/lib/tags'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** Tag names and slugs are part of the FTS document, so linked cards must be reindexed. */
function reindex(bookmarkIds: string[]) {
  for (const bookmarkId of bookmarkIds) {
    try { indexBookmarkById(bookmarkId) } catch {}
  }
}

// PATCH /api/tags/:id  { name?, color?, parentId? } — rename, recolor, or re-parent.
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const input = (body ?? {}) as Record<string, unknown>

    const prisma = getPrisma()
    const current = await prisma.category.findUnique({
      where: { id },
      select: { id: true, bookmarks: { select: { bookmarkId: true } } },
    })
    if (!current) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })

    const data: { name?: string; slug?: string; color?: string; parentId?: string | null } = {}

    if (input.name !== undefined) {
      const name = parseTagName(input.name)
      if (!name) return NextResponse.json({ error: 'Tag name required (1-60 characters)' }, { status: 400 })
      const slug = slugifyTag(name)
      if (!slug) return NextResponse.json({ error: 'Tag name must contain a letter or number' }, { status: 400 })
      const clash = await prisma.category.findFirst({
        where: { id: { not: id }, OR: [{ slug }, { name }] },
        select: { id: true },
      })
      if (clash) return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 })
      data.name = name
      data.slug = slug
    }

    if (input.color !== undefined) {
      if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
        return NextResponse.json({ error: 'Color must be a hex value like #7b2d26' }, { status: 400 })
      }
      data.color = input.color
    }

    if (input.parentId !== undefined) {
      const parentId = typeof input.parentId === 'string' && input.parentId ? input.parentId : null
      if (parentId === id) return NextResponse.json({ error: 'A tag cannot be its own parent' }, { status: 400 })
      if (parentId) {
        const all = await prisma.category.findMany({ select: { id: true, parentId: true } })
        if (!all.some(row => row.id === parentId)) {
          return NextResponse.json({ error: 'Parent tag not found' }, { status: 404 })
        }
        const parents = new Map(all.map(row => [row.id, row.parentId]))
        if (wouldCycle(parents, id, parentId)) {
          return NextResponse.json({ error: 'That move would nest the tag inside itself' }, { status: 400 })
        }
      }
      data.parentId = parentId
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const tag = await prisma.category.update({
      where: { id },
      data,
      select: { id: true, name: true, slug: true, color: true, parentId: true },
    })
    if (data.name) reindex(current.bookmarks.map(b => b.bookmarkId))

    return NextResponse.json({ ok: true, tag })
  } catch (err) {
    return apiError('Could not update tag', err, 500)
  }
}

// DELETE /api/tags/:id — removes the tag. Cards keep existing (only the link is
// dropped) and child tags are promoted to the level the deleted tag occupied,
// because Category.parentId is onDelete: SetNull.
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const prisma = getPrisma()
    const tag = await prisma.category.findUnique({
      where: { id },
      select: { id: true, bookmarks: { select: { bookmarkId: true } }, children: { select: { id: true } } },
    })
    if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })

    const affected = tag.bookmarks.map(b => b.bookmarkId)
    await prisma.category.delete({ where: { id } })
    reindex(affected)

    return NextResponse.json({ ok: true, cardsUntagged: affected.length, childrenPromoted: tag.children.length })
  } catch (err) {
    return apiError('Could not delete tag', err, 500)
  }
}
