import { getPrisma } from './db'
import { cosineSimilarity, deserializeEmbedding, embedBookmark, embeddingTextForBookmark, storeBookmarkEmbedding } from './embeddings'

const DEFAULT_RELATED_LIMIT = 6
const MAX_RELATED_LIMIT = 12
const MAX_RELATED_CANDIDATES = 500

const RELATED_CARD_SELECT = {
  id: true,
  title: true,
  provider: true,
  postUrl: true,
  text: true,
  body: true,
  summary: true,
  notebookContent: true,
  sourceType: true,
  thumbnail: true,
  shared: true,
  status: true,
  importedAt: true,
  updatedAt: true,
  semanticTags: true,
  embedding: true,
  categories: { select: { category: { select: { name: true, slug: true, color: true } } } },
} as const

type RelatedRow = {
  id: string
  title: string | null
  provider: string | null
  postUrl: string
  text: string
  body: string | null
  summary: string | null
  notebookContent: string | null
  sourceType: string
  thumbnail: string | null
  shared: boolean
  status: string
  importedAt: Date
  updatedAt: Date
  semanticTags: string | null
  embedding: Uint8Array | null
  categories: { category: { name: string; slug: string; color: string } }[]
}

export interface RelatedCardResult {
  id: string
  title: string
  provider: string | null
  url: string
  summary: string | null
  status: string
  sourceType: string
  thumbnail: string | null
  shared: boolean
  createdAt: Date
  updatedAt: Date
  tags: { name: string; slug: string; color: string }[]
  score: number
}

export async function findRelatedCards(cardId: string, requestedLimit?: number): Promise<RelatedCardResult[] | null> {
  const limit = normalizeLimit(requestedLimit)
  const prisma = getPrisma()
  const current = (await prisma.bookmark.findUnique({
    where: { id: cardId },
    select: RELATED_CARD_SELECT,
  })) as RelatedRow | null

  if (!current) return null

  const currentEmbedding = await ensureRowEmbedding(current)
  if (!currentEmbedding) return []

  const candidates = (await prisma.bookmark.findMany({
    where: { id: { not: cardId } },
    select: RELATED_CARD_SELECT,
    orderBy: { updatedAt: 'desc' },
    take: MAX_RELATED_CANDIDATES,
  })) as RelatedRow[]

  const ranked: Array<{ row: RelatedRow; score: number }> = []
  for (const candidate of candidates) {
    const embedding = await ensureRowEmbedding(candidate)
    if (!embedding || embedding.length !== currentEmbedding.length) continue
    const score = cosineSimilarity(currentEmbedding, embedding)
    if (!Number.isFinite(score)) continue
    ranked.push({ row: candidate, score })
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({
      id: row.id,
      title: row.title || row.text.slice(0, 120) || 'Untitled',
      provider: row.provider,
      url: row.postUrl,
      summary: row.summary,
      status: row.status,
      sourceType: row.sourceType,
      thumbnail: row.thumbnail,
      shared: row.shared,
      createdAt: row.importedAt,
      updatedAt: row.updatedAt,
      tags: row.categories.map(c => c.category),
      score,
    }))
}

async function ensureRowEmbedding(row: RelatedRow): Promise<number[] | null> {
  let embedding = deserializeEmbedding(row.embedding)
  const categoryTerms = row.categories.flatMap(c => [c.category.name, c.category.slug])
  if (!embedding && embeddingTextForBookmark({ ...row, categories: categoryTerms })) {
    const serialized = await embedBookmark({ ...row, categories: categoryTerms })
    if (!serialized) return null
    storeBookmarkEmbedding(row.id, serialized)
    embedding = deserializeEmbedding(serialized)
  }
  return embedding
}

function normalizeLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_RELATED_LIMIT
  return Math.min(MAX_RELATED_LIMIT, Math.max(1, Math.floor(value)))
}
