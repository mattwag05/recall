import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'

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

    return NextResponse.json({ tags: roots.map(toPublicNode) })
  } catch (err) {
    return NextResponse.json({ error: `Could not load tags: ${String(err)}` }, { status: 500 })
  }
}
