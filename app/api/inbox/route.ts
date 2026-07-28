import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { apiError } from '@/lib/api-errors'
import { cardTitle } from '@/lib/format'
import { inboxWhere } from '@/lib/triage'

export const runtime = 'nodejs'

// One queue-load at a time. The inbox is reviewed card-by-card and refetches
// when it empties, so there is no offset/sort to configure.
const INBOX_TAKE = 50

const INBOX_SELECT = {
  id: true,
  title: true,
  text: true,
  provider: true,
  postUrl: true,
  summary: true,
  status: true,
  sourceType: true,
  thumbnail: true,
  notes: true,
  importedAt: true,
  categories: { select: { category: { select: { name: true, slug: true, color: true } } } },
} as const

// GET /api/inbox        -> { cards, total }
// GET /api/inbox?count=1 -> { total }   (cheap; polled by the nav badge)
export async function GET(request: Request) {
  try {
    const prisma = getPrisma()
    const where = inboxWhere()
    const total = await prisma.bookmark.count({ where })

    if (new URL(request.url).searchParams.has('count')) {
      return NextResponse.json({ total })
    }

    const rows = await prisma.bookmark.findMany({
      where,
      select: INBOX_SELECT,
      orderBy: { importedAt: 'desc' },
      take: INBOX_TAKE,
    })

    const cards = rows.map(row => ({
      id: row.id,
      title: cardTitle(row.title, row.text),
      text: row.text,
      provider: row.provider,
      url: row.postUrl,
      summary: row.summary,
      status: row.status,
      sourceType: row.sourceType,
      thumbnail: row.thumbnail,
      notes: row.notes,
      createdAt: row.importedAt,
      tags: row.categories.map(c => c.category),
    }))

    return NextResponse.json({ cards, total })
  } catch (err) {
    return apiError('Could not load the inbox', err, 500)
  }
}
