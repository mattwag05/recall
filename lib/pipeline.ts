import { getPrisma } from './db'
import { extractEntities } from './entity-extractor'
import { tagBookmarks } from './semantic-tagger'
import { classifyBookmarks } from './categorizer'
import { indexBookmark } from './fts'
import { summarizeBookmarks, type SummarizeInput } from './summarizer'
import { generateNotebooks, extractTldr, fallbackNotebook } from './notebook'
import { embedBookmark, storeBookmarkEmbedding } from './embeddings'
import { generateEntityConnections } from './connections'

export interface PipelineProgress {
  stage: 'entity_extraction' | 'semantic_tagging' | 'categorization' | 'summarization' | 'connection_generation' | 'embedding'
  current: number
  total: number
  message: string
}

export interface PipelineOptions {
  batchSize?: number  // default 20
  stages?: PipelineProgress['stage'][]
  forceRe?: boolean  // re-enrich already-enriched bookmarks
  onProgress?: (progress: PipelineProgress) => void
}

const ALL_STAGES: Array<PipelineProgress['stage']> = [
  'entity_extraction',
  'semantic_tagging',
  'categorization',
  'summarization',
  'connection_generation',
  'embedding',
]

export async function runPipeline(options: PipelineOptions = {}): Promise<{ processed: number; errors: number }> {
  const {
    batchSize = 20,
    stages = ALL_STAGES,
    forceRe = false,
    onProgress,
  } = options

  const prisma = getPrisma()
  let processed = 0
  let errors = 0

  const stageSet = new Set(stages)
  const report = (stage: PipelineProgress['stage'], current: number, total: number, message: string) => {
    onProgress?.({ stage, current, total, message })
  }

  // ── Stage 1: Entity extraction ────────────────────────────────────────────
  if (stageSet.has('entity_extraction')) {
    const bookmarks = await prisma.bookmark.findMany({
      where: forceRe ? {} : { entities: null },
      select: { id: true, text: true },
    })

    report('entity_extraction', 0, bookmarks.length, `Extracting entities from ${bookmarks.length} bookmarks…`)

    for (let i = 0; i < bookmarks.length; i++) {
      const b = bookmarks[i]
      try {
        const entities = extractEntities(b.text)
        await prisma.bookmark.update({
          where: { id: b.id },
          data: { entities: JSON.stringify(entities) },
        })
        processed++
      } catch {
        errors++
      }
      report('entity_extraction', i + 1, bookmarks.length, `Entity extraction: ${i + 1}/${bookmarks.length}`)
    }
  }

  // ── Stage 2: Semantic tagging ─────────────────────────────────────────────
  if (stageSet.has('semantic_tagging')) {
    // Gather image tags per bookmark
    const bookmarks = await prisma.bookmark.findMany({
      where: forceRe ? {} : {
        OR: [
          { semanticTags: null },
          { semanticTags: '[]' },
          { categories: { none: { category: { isAiGenerated: true } } } },
        ],
      },
      select: {
        id: true,
        text: true,
        title: true,
        body: true,
        entities: true,
        mediaItems: { select: { imageTags: true } },
      },
    })

    report('semantic_tagging', 0, bookmarks.length, `Tagging ${bookmarks.length} bookmarks…`)

    // Prepare input with combined image tags. Pass title+body so tags reflect
    // the article's subject, not the host site's boilerplate excerpt.
    const input = bookmarks.map(b => ({
      id: b.id,
      text: b.text,
      title: b.title,
      body: b.body,
      entities: b.entities,
      imageTags: (() => {
        const allTags: string[] = []
        for (const m of b.mediaItems) {
          if (m.imageTags) {
            allTags.push(...parseImageTags(m.imageTags))
          }
        }
        return allTags.length > 0 ? JSON.stringify([...new Set(allTags)]) : null
      })(),
    }))

    // Process in batches
    for (let i = 0; i < input.length; i += batchSize) {
      const batch = input.slice(i, i + batchSize)
      try {
        const tagsMap = await tagBookmarks(batch)
        for (const [id, tags] of tagsMap) {
          try {
            await prisma.bookmark.update({
              where: { id },
              data: { semanticTags: JSON.stringify(tags) },
            })
            await attachSemanticTagCategories(id, tags)
            processed++
          } catch {
            errors++
          }
        }
      } catch {
        errors += batch.length
      }
      report('semantic_tagging', i + batch.length, input.length, `Tagged ${i + batch.length}/${input.length} bookmarks`)
    }
  }

  // ── Stage 4: Categorization ───────────────────────────────────────────────
  if (stageSet.has('categorization')) {
    const availableCategories = await prisma.category.findMany({
      select: { id: true, slug: true, name: true, description: true },
    })

    const bookmarks = await prisma.bookmark.findMany({
      where: forceRe ? {} : { actionability: null },
      select: {
        id: true,
        title: true,
        text: true,
        body: true,
        summary: true,
        notebookContent: true,
        postUrl: true,
        semanticTags: true,
        entities: true,
      },
    })

    report('categorization', 0, bookmarks.length, `Classifying ${bookmarks.length} bookmarks…`)

    for (let i = 0; i < bookmarks.length; i += batchSize) {
      const batch = bookmarks.slice(i, i + batchSize)
      try {
        const results = await classifyBookmarks(batch, availableCategories)

        // Prefetch all media items for the batch to avoid N+1 queries
        const bookmarkIds = results.map(r => r.bookmarkId)
        const mediaByBookmarkId = new Map<string, string>()
        const mediaItems = await prisma.mediaItem.findMany({
          where: { bookmarkId: { in: bookmarkIds } },
          select: { bookmarkId: true, imageTags: true },
        })
        for (const item of mediaItems) {
          const tags = item.imageTags ? parseImageTags(item.imageTags) : []
          const existing = mediaByBookmarkId.get(item.bookmarkId) ?? ''
          mediaByBookmarkId.set(item.bookmarkId, (existing + ' ' + tags.join(' ')).trim())
        }

        for (const result of results) {
          try {
            // Upsert BookmarkCategory records
            for (const cat of result.categories) {
              const category = availableCategories.find(c => c.slug === cat.categorySlug)
              if (!category) continue
              await prisma.bookmarkCategory.upsert({
                where: { bookmarkId_categoryId: { bookmarkId: result.bookmarkId, categoryId: category.id } },
                create: {
                  bookmarkId: result.bookmarkId,
                  categoryId: category.id,
                  confidence: cat.confidence,
                },
                update: { confidence: cat.confidence },
              })
            }

            // Find the bookmark data from the batch
            const bk = batch.find(b => b.id === result.bookmarkId)
            if (!bk) continue

            // Update actionability and enrichment metadata
            await prisma.bookmark.update({
              where: { id: result.bookmarkId },
              data: {
                actionability: result.actionability,
                enrichedAt: new Date(),
                enrichmentMeta: JSON.stringify({
                  enrichedAt: new Date().toISOString(),
                  stages: Array.from(stageSet),
                }),
              },
            })

            // Update FTS index using prefetched media items
            const imageTags = mediaByBookmarkId.get(result.bookmarkId) ?? ''
            indexBookmark({
              bookmarkId: bk.id,
              title: bk.title,
              text: bk.text,
              body: bk.body,
              summary: bk.summary,
              notebookContent: bk.notebookContent,
              semanticTags: bk.semanticTags,
              entities: bk.entities,
              imageTagTerms: imageTags,
            })

            processed++
          } catch {
            errors++
          }
        }
      } catch {
        errors += batch.length
      }
      report('categorization', i + batch.length, bookmarks.length, `Categorization: ${i + batch.length}/${bookmarks.length}`)
    }
  }

  // ── Stage 5: Notebook + summary ────────────────────────────────────────────
  // The Notebook is the source of truth: we generate it, then derive the 1-line
  // `summary` from its TL;DR (consistent preview, one fewer LLM call). Notebooks
  // are only (re)generated when missing unless forceRe, so user edits survive.
  if (stageSet.has('summarization')) {
    const notebookTargets = await prisma.bookmark.findMany({
      where: forceRe ? {} : {
        OR: [
          { notebookContent: null },
          { summary: 'One or two crisp sentences capturing the core point.' },
          { summary: { startsWith: 'I apologize' } },
        ],
      },
      select: { id: true, title: true, text: true, body: true, sourceType: true, status: true, semanticTags: true, entities: true },
    })
    const withContent = notebookTargets.filter(canGenerateTextSummary)
    report('summarization', 0, withContent.length, `Building ${withContent.length} notebooks…`)

    const notebooks = await generateNotebooks(
      withContent.map(b => ({ id: b.id, title: b.title, text: b.text, body: b.body })),
      (current, total) => report('summarization', current, total, `Notebook: ${current}/${total}`),
    )

    const remainingForSummary: SummarizeInput[] = []
    for (const b of withContent) {
      const notebookContent = notebooks.get(b.id) || fallbackNotebook(b)
      if (notebookContent) {
        const tldr = extractTldr(notebookContent)
        try {
          await prisma.bookmark.update({
            where: { id: b.id },
            data: {
              notebookContent,
              status: 'ready',
              ...(tldr ? { summary: tldr } : {}),
            },
          })
          indexBookmark({
            bookmarkId: b.id,
            title: b.title,
            text: b.text,
            body: b.body,
            summary: tldr,
            notebookContent,
            semanticTags: b.semanticTags,
            entities: b.entities,
          })
          processed++
        } catch {
          errors++
        }
        if (!tldr) remainingForSummary.push({ id: b.id, text: b.text, body: b.body })
      } else {
        // Notebook generation failed — still give the card a plain summary.
        remainingForSummary.push({ id: b.id, text: b.text, body: b.body })
      }
    }

    // Fallback 1-line summaries for cards whose notebook had no TL;DR / failed,
    // and any card still missing a summary.
    const missingSummary = await prisma.bookmark.findMany({
      where: { summary: null, OR: [{ body: { not: null } }, { text: { not: '' } }] },
      select: { id: true, title: true, text: true, body: true, sourceType: true, status: true, notebookContent: true, semanticTags: true, entities: true },
    })
    const summarizeIds = new Set(remainingForSummary.map(r => r.id))
    for (const m of missingSummary) {
      if (!summarizeIds.has(m.id) && canGenerateTextSummary(m)) remainingForSummary.push(m)
    }

    if (remainingForSummary.length > 0) {
      const summaries = await summarizeBookmarks(remainingForSummary)
      for (const [id, summary] of summaries) {
        try {
          const updated = await prisma.bookmark.update({ where: { id }, data: { summary, status: 'ready' } })
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
          processed++
        } catch {
          errors++
        }
      }

      // If both Notebook and fallback summary fail, keep the extracted card
      // readable instead of polling forever. Users can regenerate from detail.
      const summarizedIds = new Set(summaries.keys())
      const unresolved = new Map(remainingForSummary.filter(item => !summarizedIds.has(item.id)).map(item => [item.id, item]))
      for (const [id, item] of unresolved) {
        try {
          const summary = fallbackSummary(item)
          const updated = await prisma.bookmark.update({
            where: { id },
            data: summary ? { status: 'ready', summary } : { status: 'ready' },
          })
          if (summary) {
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
            processed++
            continue
          }
        } catch {}
        errors++
      }
    }
  }

  // ── Stage 6: Local connection generation ──────────────────────────────────
  // Build deterministic entity links from local metadata after entity/tag/category
  // enrichment. This does not call the LLM and is idempotent per card.
  if (stageSet.has('connection_generation')) {
    const bookmarks = await prisma.bookmark.findMany({
      where: forceRe ? {} : { connectionsOut: { none: { origin: 'ai' } } },
      select: { id: true },
    })

    report('connection_generation', 0, bookmarks.length, `Generating local links for ${bookmarks.length} cards…`)

    for (let i = 0; i < bookmarks.length; i++) {
      const b = bookmarks[i]
      try {
        const result = await generateEntityConnections(b.id)
        if (result.created > 0) processed++
      } catch {
        errors++
      }
      report('connection_generation', i + 1, bookmarks.length, `Connections: ${i + 1}/${bookmarks.length}`)
    }
  }

  // ── Stage 7: Local embeddings ─────────────────────────────────────────────
  // Full-card vectors power Phase 2 semantic search and become the base for
  // related-card/RAG work. Existing libraries backfill lazily here or during
  // semantic search; user edits invalidate embeddings in the card API.
  if (stageSet.has('embedding')) {
    const bookmarks = await prisma.bookmark.findMany({
      where: forceRe ? {} : { embedding: null },
      select: {
        id: true,
        title: true,
        text: true,
        body: true,
        summary: true,
        notebookContent: true,
        semanticTags: true,
        categories: { select: { category: { select: { name: true, slug: true } } } },
      },
    })

    report('embedding', 0, bookmarks.length, `Embedding ${bookmarks.length} cards…`)

    for (let i = 0; i < bookmarks.length; i++) {
      const b = bookmarks[i]
      try {
        const embedding = await embedBookmark({
          ...b,
          categories: b.categories.flatMap(c => [c.category.name, c.category.slug]),
        })
        if (embedding) {
          storeBookmarkEmbedding(b.id, embedding)
          processed++
        }
      } catch {
        errors++
      }
      report('embedding', i + 1, bookmarks.length, `Embedding: ${i + 1}/${bookmarks.length}`)
    }
  }

  return { processed, errors }
}

function parseImageTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    // Support both full VisionResult objects and legacy tag arrays.
    const rawTags = Array.isArray(parsed)
      ? parsed
      : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).tags)
        ? (parsed as Record<string, unknown>).tags as unknown[]
        : []
    return rawTags.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    return []
  }
}

function canGenerateTextSummary(card: { body: string | null; text: string | null; sourceType: string; status: string }): boolean {
  if ((card.body ?? '').trim().length > 0) return true
  if (card.sourceType === 'url' && card.status === 'failed') return false
  return (card.text ?? '').trim().length > 0
}

function fallbackSummary(card: { body?: string | null; text?: string | null }): string | null {
  // ponytail: excerpt fallback; replace with model summaries when the local LLM is healthy.
  const source = (card.body || card.text || '').replace(/\s+/g, ' ').trim()
  if (!source) return null
  const firstSentence = source.split(/(?<=[.!?])\s+/)[0] ?? source
  const base = firstSentence.length >= 40 ? firstSentence : source
  return base.length > 260 ? `${base.slice(0, 257).trimEnd()}...` : base
}

async function attachSemanticTagCategories(bookmarkId: string, tags: string[]): Promise<void> {
  const prisma = getPrisma()
  for (const slug of tags.slice(0, 8)) {
    if (!slug || slug.length < 2) continue
    const category = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: {
        name: titleizeTag(slug),
        slug,
        color: '#64748b',
        isAiGenerated: true,
      },
    })
    await prisma.bookmarkCategory.upsert({
      where: { bookmarkId_categoryId: { bookmarkId, categoryId: category.id } },
      create: { bookmarkId, categoryId: category.id, confidence: 0.6 },
      update: { confidence: 0.6 },
    })
  }
}

function titleizeTag(slug: string): string {
  const upper = new Set(['ai', 'ml', 'llm', 'soc'])
  return slug
    .split('-')
    .filter(Boolean)
    .map(part => upper.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
