import { getPrisma } from './db'
import JSZip from 'jszip'
import { Prisma } from '@prisma/client'
import { getCategorySubtreeSlugs } from './category-hierarchy'
import { cardToMarkdown, type ExportableCard } from './markdown-export'

export interface ExportFilters {
  platform?: string
  category?: string
  actionability?: string
}

export async function categoryFilterExists(categorySlug?: string): Promise<boolean> {
  if (!categorySlug) return true
  const prisma = getPrisma()
  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
    select: { id: true },
  })
  return Boolean(category)
}

async function buildWhere(filters: ExportFilters): Promise<Prisma.BookmarkWhereInput> {
  const prisma = getPrisma()
  const where: Prisma.BookmarkWhereInput = {}
  if (filters.platform) where.platform = filters.platform
  if (filters.actionability) where.actionability = filters.actionability
  if (filters.category) {
    const categorySlugs = await getCategorySubtreeSlugs(prisma, filters.category)
    where.categories = { some: { category: { slug: { in: categorySlugs } } } }
  }
  return where
}

type BookmarkWithRelations = Prisma.BookmarkGetPayload<{
  include: {
    mediaItems: true
    categories: { include: { category: true } }
    connectionsOut: { include: { to: true } }
    quizQuestions: true
  }
}>

async function fetchBookmarks(filters: ExportFilters): Promise<BookmarkWithRelations[]> {
  const prisma = getPrisma()
  const where = await buildWhere(filters)
  return prisma.bookmark.findMany({
    where,
    orderBy: { importedAt: 'desc' },
    include: {
      mediaItems: true,
      categories: { include: { category: true } },
      connectionsOut: {
        include: { to: true },
        orderBy: { createdAt: 'desc' },
      },
      quizQuestions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })
}

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

export async function exportCsv(filters: ExportFilters): Promise<string> {
  const bookmarks = await fetchBookmarks(filters)
  const headers = ['id', 'postId', 'platform', 'text', 'authorHandle', 'postUrl', 'actionability', 'categories', 'importedAt']
  const rows = bookmarks.map((b) => [
    escapeCsv(b.id),
    escapeCsv(b.postId ?? ''),
    escapeCsv(b.platform),
    escapeCsv(b.text),
    escapeCsv(b.authorHandle ?? ''),
    escapeCsv(b.postUrl ?? ''),
    escapeCsv(b.actionability ?? ''),
    escapeCsv(b.categories.map((bc) => bc.category.name).join('; ')),
    escapeCsv(b.importedAt.toISOString()),
  ])
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

export async function exportJson(filters: ExportFilters): Promise<object[]> {
  const bookmarks = await fetchBookmarks(filters)
  return bookmarks.map((b) => ({
    id: b.id,
    postId: b.postId,
    platform: b.platform,
    text: b.text,
    postUrl: b.postUrl,
    authorHandle: b.authorHandle,
    authorName: b.authorName,
    postCreatedAt: b.postCreatedAt,
    importedAt: b.importedAt,
    actionability: b.actionability,
    saveAction: b.saveAction,
    semanticTags: parseJsonStringArray(b.semanticTags),
    entities: parseJsonObject(b.entities),
    enrichedAt: b.enrichedAt,
    mediaItems: b.mediaItems.map((m) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      localPath: m.localPath,
    })),
    categories: b.categories.map((bc) => ({
      id: bc.category.id,
      name: bc.category.name,
      slug: bc.category.slug,
      color: bc.category.color,
      confidence: bc.confidence,
    })),
  }))
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function exportZip(filters: ExportFilters): Promise<Buffer> {
  const [csvData, jsonData] = await Promise.all([
    exportCsv(filters),
    exportJson(filters),
  ])
  const zip = new JSZip()
  zip.file('bookmarks.csv', csvData)
  zip.file('bookmarks.json', JSON.stringify(jsonData, null, 2))
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  return buffer
}

export async function exportMarkdown(filters: ExportFilters): Promise<{ markdown: string; count: number }> {
  const bookmarks = await fetchBookmarks(filters)
  const docs = bookmarks.map(b => cardToMarkdown(b as unknown as ExportableCard))
  const label = filters.category ? ` · tag: ${filters.category}` : ''
  const markdown =
    `# Recall export\n\n_${bookmarks.length} cards${label} · ${new Date().toISOString().slice(0, 10)}_\n\n` +
    docs.join('\n\n---\n\n')

  return { markdown, count: bookmarks.length }
}
