import { llmChat } from './ai-client'
import { extractJson } from './json-utils'

export interface CategoryAssignment {
  categorySlug: string
  confidence: number  // 0.5-1.0
}

export interface ClassificationResult {
  bookmarkId: string
  categories: CategoryAssignment[]  // 1-3 categories
  actionability: 'inspiration' | 'try_this' | 'build_this' | 'reference'
}

const FALLBACK_ACTIONABILITY = 'inspiration' as const
const FALLBACK_CATEGORY = 'general'

export async function classifyBookmarks(
  bookmarks: Array<{ id: string; text: string; body: string | null; postUrl: string | null; semanticTags: string | null; entities: string | null }>,
  availableCategories: Array<{ slug: string; name: string; description: string | null }>
): Promise<ClassificationResult[]> {
  if (bookmarks.length === 0) return []

  const results: ClassificationResult[] = []

  // Process in batches of 20
  const BATCH_SIZE = 20
  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    const batch = bookmarks.slice(i, i + BATCH_SIZE)
    try {
      const batchResults = await classifyBatch(batch, availableCategories)
      results.push(...batchResults)
    } catch {
      // Fallback for entire failed batch
      for (const b of batch) {
        results.push(makeFallback(b.id, availableCategories))
      }
    }
  }

  return results
}

function makeFallback(
  bookmarkId: string,
  availableCategories: Array<{ slug: string; name: string; description: string | null }>
): ClassificationResult {
  const generalExists = availableCategories.some(c => c.slug === FALLBACK_CATEGORY)
  const fallbackSlug = generalExists
    ? FALLBACK_CATEGORY
    : (availableCategories[0]?.slug ?? FALLBACK_CATEGORY)

  return {
    bookmarkId,
    categories: [{ categorySlug: fallbackSlug, confidence: 0.5 }],
    actionability: FALLBACK_ACTIONABILITY,
  }
}

async function classifyBatch(
  bookmarks: Array<{ id: string; text: string; body: string | null; postUrl: string | null; semanticTags: string | null; entities: string | null }>,
  availableCategories: Array<{ slug: string; name: string; description: string | null }>
): Promise<ClassificationResult[]> {
  const categoryList = availableCategories.map(c => {
    const desc = c.description ? ` — ${c.description}` : ''
    return `  - "${c.slug}" (${c.name})${desc}`
  }).join('\n')

  const items = bookmarks.map(b => {
    const parts: string[] = [`[${b.id}]`]
    if (b.text) parts.push(`Title: ${b.text}`)
    if (b.body) {
      const truncated = b.body.length > 2000 ? b.body.slice(0, 2000) + '…' : b.body
      parts.push(`Body: ${truncated}`)
    }
    if (b.postUrl) {
      try {
        const domain = new URL(b.postUrl).hostname.replace(/^www\./, '')
        parts.push(`Source: ${domain}`)
      } catch {}
    }
    if (b.semanticTags) {
      try {
        const tags = JSON.parse(b.semanticTags) as unknown
        const strings = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
        if (strings.length > 0) {
          parts.push(`Tags: ${strings.join(', ')}`)
        }
      } catch {}
    }
    if (b.entities) {
      const flat = parseEntityValues(b.entities).join(', ')
      if (flat) parts.push(`Entities: ${flat}`)
    }
    return parts.join('\n')
  })

  const prompt = `Classify each bookmark into 1-3 categories from the provided list, and assign an actionability label.

Available categories:
${categoryList}

Actionability definitions:
- "inspiration": interesting concept but no immediate action
- "try_this": worth trying/experimenting with soon
- "build_this": concrete project idea to build
- "reference": useful reference material to revisit

Examples:
- A post about "React Server Components: a deep dive" with tags [react, performance, webdev] → { categories: [{categorySlug: "learning", confidence: 0.9}], actionability: "reference" }
- A post about "I built a CLI tool that generates API docs from your OpenAPI spec" with tags [cli, docs, automation] → { categories: [{categorySlug: "dev-tools", confidence: 0.95}, {categorySlug: "project-ideas", confidence: 0.6}], actionability: "try_this" }
- A post with an image of a brutalist living room and tags [design, architecture, interior] → { categories: [{categorySlug: "design", confidence: 0.9}], actionability: "inspiration" }
- A post about "OpenAI releases o3 with 87% on ARC-AGI" → { categories: [{categorySlug: "ai-agents", confidence: 0.95}], actionability: "reference" }

For each bookmark, return a JSON object. Respond with ONLY a JSON array — no markdown, no explanation.

Each element must have:
- "bookmarkId": string (the ID in brackets)
- "categories": array of 1-3 objects with "categorySlug" (string) and "confidence" (number 0.5-1.0)
- "actionability": one of "inspiration", "try_this", "build_this", "reference"

Bookmarks:
${items.join('\n\n---\n\n')}`

  const content = await llmChat([{ role: 'user', content: prompt }], {
    stage: 'categorization',
    maxTokens: 1500,
  })
  const cleaned = extractJson(content)

  const validActionabilities = new Set(['inspiration', 'try_this', 'build_this', 'reference'])
  const validSlugs = new Set(availableCategories.map(c => c.slug))

  try {
    const parsed = JSON.parse(cleaned) as unknown[]
    const idSet = new Set(bookmarks.map(b => b.id))
    const results: ClassificationResult[] = []

    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const obj = item as Record<string, unknown>
      const bookmarkId = typeof obj.bookmarkId === 'string' ? obj.bookmarkId : null
      if (!bookmarkId || !idSet.has(bookmarkId)) continue

      const rawCategories = Array.isArray(obj.categories) ? obj.categories : []
      const categories: CategoryAssignment[] = (rawCategories as unknown[])
        .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
        .map(c => ({
          categorySlug: typeof c.categorySlug === 'string' && validSlugs.has(c.categorySlug)
            ? c.categorySlug
            : (availableCategories[0]?.slug ?? FALLBACK_CATEGORY),
          confidence: typeof c.confidence === 'number'
            ? Math.min(1.0, Math.max(0.5, c.confidence))
            : 0.5,
        }))
        .slice(0, 3)

      if (categories.length === 0) {
        categories.push({ categorySlug: availableCategories[0]?.slug ?? FALLBACK_CATEGORY, confidence: 0.5 })
      }

      const actionabilityRaw = typeof obj.actionability === 'string' ? obj.actionability : ''
      const actionability = validActionabilities.has(actionabilityRaw)
        ? (actionabilityRaw as ClassificationResult['actionability'])
        : FALLBACK_ACTIONABILITY

      results.push({ bookmarkId, categories, actionability })
    }

    // Fill in any bookmarks missing from the response
    const returnedIds = new Set(results.map(r => r.bookmarkId))
    for (const b of bookmarks) {
      if (!returnedIds.has(b.id)) {
        results.push(makeFallback(b.id, availableCategories))
      }
    }

    return results
  } catch {
    return bookmarks.map(b => makeFallback(b.id, availableCategories))
  }
}

function parseEntityValues(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.values(parsed)
      .flat()
      .filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}
