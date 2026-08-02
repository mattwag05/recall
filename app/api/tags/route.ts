import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { apiError } from '@/lib/api-errors'
import { parseTagName, slugifyTag, tagColor } from '@/lib/tags'

export const runtime = 'nodejs'

export interface TagNode {
  id: string
  name: string
  slug: string
  color: string
  parentId: string | null
  count: number
  children: TagNode[]
}

type InternalTagNode = TagNode & {
  bookmarkIds: Set<string>
}

function aggregateBookmarkIds(node: InternalTagNode): Set<string> {
  const ids = new Set(node.bookmarkIds)
  for (const child of node.children as InternalTagNode[]) {
    for (const id of aggregateBookmarkIds(child)) ids.add(id)
  }
  node.count = ids.size
  return ids
}

function toPublicNode(node: InternalTagNode): TagNode {
  return {
    id: node.id,
    name: node.name,
    slug: node.slug,
    color: node.color,
    parentId: node.parentId,
    count: node.count,
    children: (node.children as InternalTagNode[]).map(toPublicNode),
  }
}

// GET /api/tags — hierarchical tag tree with unique subtree card counts.
export async function GET() {
  try {
    const prisma = getPrisma()
    const cats = await prisma.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        parentId: true,
        bookmarks: { select: { bookmarkId: true } },
      },
      orderBy: { name: 'asc' },
    })

    const byId = new Map<string, InternalTagNode>()
    for (const c of cats) {
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        slug: c.slug,
        color: c.color,
        parentId: c.parentId,
        count: c.bookmarks.length,
        children: [],
        bookmarkIds: new Set(c.bookmarks.map(bookmark => bookmark.bookmarkId)),
      })
    }

    const roots: InternalTagNode[] = []
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    for (const root of roots) aggregateBookmarkIds(root)

    const untagged = await prisma.bookmark.count({ where: { categories: { none: {} } } })

    return NextResponse.json({ tags: roots.map(toPublicNode), untagged })
  } catch (err) {
    return apiError('Could not load tags', err, 500)
  }
}

// POST /api/tags  { name, parentId? } — create a top-level or child tag.
export async function POST(request: Request) {
  try {
    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const input = (body ?? {}) as Record<string, unknown>

    const name = parseTagName(input.name)
    if (!name) return NextResponse.json({ error: 'Tag name required (1-60 characters)' }, { status: 400 })
    const slug = slugifyTag(name)
    if (!slug) return NextResponse.json({ error: 'Tag name must contain a letter or number' }, { status: 400 })

    const parentId = typeof input.parentId === 'string' && input.parentId ? input.parentId : null

    const prisma = getPrisma()
    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parentId }, select: { id: true } })
      if (!parent) return NextResponse.json({ error: 'Parent tag not found' }, { status: 404 })
    }

    const clash = await prisma.category.findFirst({
      where: { OR: [{ slug }, { name }] },
      select: { id: true },
    })
    if (clash) return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 })

    const total = await prisma.category.count()
    const created = await prisma.category.create({
      data: { name, slug, color: tagColor(total), isAiGenerated: false, parentId },
      select: { id: true, name: true, slug: true, color: true, parentId: true },
    })

    return NextResponse.json({ ok: true, tag: created }, { status: 201 })
  } catch (err) {
    return apiError('Could not create tag', err, 500)
  }
}
