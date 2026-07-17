import { NextResponse } from 'next/server'
import { getCategorySubtreeSlugs } from '@/lib/category-hierarchy'
import { getPrisma } from '@/lib/db'
import { cosineSimilarity, deserializeEmbedding, embedBookmark, embedText, embeddingTextForBookmark, storeBookmarkEmbedding } from '@/lib/embeddings'
import { ftsSearch, type FtsSearchSurface } from '@/lib/fts'

export const runtime = 'nodejs'

const CARD_SELECT = {
  id: true,
  title: true,
  text: true,
  provider: true,
  postUrl: true,
  summary: true,
  status: true,
  sourceType: true,
  thumbnail: true,
  shared: true,
  importedAt: true,
  updatedAt: true,
  categories: { select: { category: { select: { name: true, slug: true, color: true } } } },
} as const

const SEMANTIC_CARD_SELECT = {
  ...CARD_SELECT,
  body: true,
  notebookContent: true,
  semanticTags: true,
  embedding: true,
} as const

type Row = {
  id: string
  title: string | null
  text: string
  provider: string | null
  postUrl: string
  summary: string | null
  status: string
  sourceType: string
  thumbnail: string | null
  shared: boolean
  importedAt: Date
  updatedAt: Date
  categories: { category: { name: string; slug: string; color: string } }[]
}

type SemanticRow = Row & {
  body: string | null
  notebookContent: string | null
  semanticTags: string | null
  embedding: Uint8Array | null
}

function toCard(b: Row) {
  return {
    id: b.id,
    title: b.title || b.text.slice(0, 120) || 'Untitled',
    provider: b.provider,
    url: b.postUrl,
    summary: b.summary,
    status: b.status,
    sourceType: b.sourceType,
    thumbnail: b.thumbnail,
    shared: b.shared,
    createdAt: b.importedAt,
    updatedAt: b.updatedAt,
    tags: b.categories.map(c => c.category),
  }
}

// GET /api/cards?query=&tag=slug
export async function GET(request: Request) {
  try {
    const prisma = getPrisma()
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('query')?.trim()
    const modeResult = parseSearchMode(searchParams.get('mode'))
    if (modeResult.error) {
      return NextResponse.json({ error: modeResult.error }, { status: 400 })
    }
    const mode = modeResult.mode
    const tag = searchParams.get('tag')?.trim()
    const dateParam = searchParams.get('date')?.trim() ?? null
    const date = parseDateFilter(dateParam)
    if (dateParam && !date) {
      return NextResponse.json({ error: 'Unsupported date filter. Use today, week, or month.' }, { status: 400 })
    }
    const surfaceResult = parseSearchSurfaces(searchParams.get('surfaces'))
    if (surfaceResult.error) {
      return NextResponse.json({ error: surfaceResult.error }, { status: 400 })
    }
    const surfaces = surfaceResult.surfaces

    if (mode === 'semantic' && searchParams.has('surfaces')) {
      return NextResponse.json({ error: 'Semantic search uses full-card embeddings. Search surface filters are available in Text mode.' }, { status: 400 })
    }

    let idFilter: string[] | undefined
    if (query && mode === 'text') {
      idFilter = ftsSearch(query, surfaces)
      if (idFilter.length === 0) return NextResponse.json({ cards: [] })
    }

    const where: Record<string, unknown> = {}
    if (idFilter) where.id = { in: idFilter }
    if (date) where.updatedAt = { gte: date }
    if (tag) {
      const tagSlugs = await getCategorySubtreeSlugs(prisma, tag)
      if (tagSlugs.length === 0) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
      where.categories = { some: { category: { slug: { in: tagSlugs } } } }
    }

    if (query && mode === 'semantic') {
      const semanticRows = (await prisma.bookmark.findMany({
        where,
        select: SEMANTIC_CARD_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })) as SemanticRow[]
      const ranked = await rankSemanticRows(query, semanticRows)
      return NextResponse.json({ cards: ranked.map(toCard), mode: 'semantic' })
    }

    const rows = (await prisma.bookmark.findMany({
      where,
      select: CARD_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    })) as Row[]

    // Preserve FTS rank order when searching.
    let cards = rows.map(toCard)
    if (idFilter) {
      const order = new Map(idFilter.map((id, i) => [id, i]))
      cards = cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }

    return NextResponse.json({ cards })
  } catch (err) {
    return NextResponse.json({ error: `Could not load cards: ${String(err)}` }, { status: 500 })
  }
}

async function rankSemanticRows(query: string, rows: SemanticRow[]): Promise<SemanticRow[]> {
  if (rows.length === 0) return []
  const queryEmbedding = await embedText(query)
  const ranked: Array<{ row: SemanticRow; score: number }> = []

  for (const row of rows) {
    let embedding = deserializeEmbedding(row.embedding)
    if (!embedding || embedding.length !== queryEmbedding.length) {
      if (!embeddingTextForBookmark({
        ...row,
        categories: row.categories.flatMap(c => [c.category.name, c.category.slug]),
      })) continue
      const serialized = await embedBookmark({
        ...row,
        categories: row.categories.flatMap(c => [c.category.name, c.category.slug]),
      })
      if (!serialized) continue
      storeBookmarkEmbedding(row.id, serialized)
      embedding = deserializeEmbedding(serialized)
    }
    if (!embedding) continue
    ranked.push({ row, score: cosineSimilarity(queryEmbedding, embedding) })
  }

  return ranked
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(item => item.row)
}

function parseSearchMode(value: string | null): { mode: 'text' | 'semantic'; error?: never } | { mode?: never; error: string } {
  if (!value || value === 'text') return { mode: 'text' }
  if (value === 'semantic') return { mode: 'semantic' }
  return { error: 'Unsupported search mode. Use text or semantic.' }
}

function parseSearchSurfaces(value: string | null): { surfaces?: FtsSearchSurface[]; error?: string } {
  if (!value) return {}
  const allowed = new Set<FtsSearchSurface>(['notebook', 'reader', 'quiz'])
  const parts = value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length === 0) {
    return { error: 'Choose at least one search surface: notebook, reader, or quiz.' }
  }
  const invalid = parts.filter(part => !allowed.has(part as FtsSearchSurface))
  if (invalid.length > 0) {
    return { error: 'Unsupported search surface. Use notebook, reader, or quiz.' }
  }
  return { surfaces: parts as FtsSearchSurface[] }
}

function parseDateFilter(value: string | null): Date | null {
  const now = new Date()
  if (value === 'today') return startOfDay(now)
  if (value === 'week') return addDays(startOfDay(now), -7)
  if (value === 'month') return addDays(startOfDay(now), -30)
  return null
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
