import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api-errors'
import { getPrisma } from '@/lib/db'
import { indexBookmarkById, removeFromFts } from '@/lib/fts'
import { deleteMediaFile } from '@/lib/media-storage'
import { parseTagName, slugifyTag, tagColor } from '@/lib/tags'

export const runtime = 'nodejs'

// One selection at a time. The library selects from a single page of cards, so
// a cap well above the 500-card list keeps a malformed request from scanning.
const MAX_IDS = 500

function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0 || ids.length > MAX_IDS) return null
  return [...new Set(ids)]
}

// POST /api/cards/bulk  { ids, action: 'delete' | 'tag', tag? }
export async function POST(request: Request) {
  try {
    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const input = (body ?? {}) as Record<string, unknown>

    const ids = parseIds(input.ids)
    if (!ids) return NextResponse.json({ error: `Select between 1 and ${MAX_IDS} cards` }, { status: 400 })

    const action = input.action
    if (action !== 'delete' && action !== 'tag') {
      return NextResponse.json({ error: 'Unsupported bulk action. Use delete or tag.' }, { status: 400 })
    }

    const prisma = getPrisma()
    const existing = await prisma.bookmark.findMany({ where: { id: { in: ids } }, select: { id: true } })
    if (existing.length === 0) return NextResponse.json({ error: 'None of those cards exist' }, { status: 404 })
    const found = existing.map(card => card.id)

    if (action === 'delete') {
      const media = await prisma.mediaItem.findMany({
        where: { bookmarkId: { in: found }, localPath: { not: null } },
        select: { localPath: true },
      })
      await prisma.bookmark.deleteMany({ where: { id: { in: found } } })
      await Promise.all(media.map(item => item.localPath ? deleteMediaFile(item.localPath) : Promise.resolve()))
      for (const id of found) {
        try { removeFromFts(id) } catch {}
      }
      return NextResponse.json({ ok: true, deleted: found.length })
    }

    const name = parseTagName(input.tag)
    if (!name) return NextResponse.json({ error: 'Tag name required (1-60 characters)' }, { status: 400 })
    const slug = slugifyTag(name)
    if (!slug) return NextResponse.json({ error: 'Tag name must contain a letter or number' }, { status: 400 })

    let category = await prisma.category.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, color: true } })
    if (!category) {
      const total = await prisma.category.count()
      category = await prisma.category.create({
        data: { name, slug, color: tagColor(total), isAiGenerated: false },
        select: { id: true, name: true, slug: true, color: true },
      })
    }

    // SQLite has no skipDuplicates, so read the existing links first rather
    // than upserting one card at a time.
    const linked = await prisma.bookmarkCategory.findMany({
      where: { categoryId: category.id, bookmarkId: { in: found } },
      select: { bookmarkId: true },
    })
    const alreadyLinked = new Set(linked.map(row => row.bookmarkId))
    const missing = found.filter(id => !alreadyLinked.has(id))
    if (missing.length > 0) {
      await prisma.bookmarkCategory.createMany({
        data: missing.map(bookmarkId => ({ bookmarkId, categoryId: category.id, confidence: 1.0 })),
      })
    }
    // Tags feed both the embedding text and the FTS document.
    await prisma.bookmark.updateMany({ where: { id: { in: found } }, data: { embedding: null } })
    for (const id of found) {
      try { indexBookmarkById(id) } catch {}
    }

    return NextResponse.json({ ok: true, tagged: found.length, tag: { name: category.name, slug: category.slug, color: category.color } })
  } catch (err) {
    return apiError('Could not apply the bulk action', err, 500)
  }
}
