import { llmChat } from './ai-client'
import { extractJson } from './json-utils'

export interface TagInput {
  id: string
  text: string
  title?: string | null
  body?: string | null
  entities: string | null
  imageTags: string | null
}

export async function tagBookmarks(
  bookmarks: TagInput[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (bookmarks.length === 0) return result

  // Process in batches of 20
  const BATCH_SIZE = 20
  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    const batch = bookmarks.slice(i, i + BATCH_SIZE)
    try {
      const batchResult = await tagBatch(batch)
      for (const [id, tags] of batchResult) {
        result.set(id, tags)
      }
    } catch {
      for (const b of batch) {
        result.set(b.id, fallbackTagsForBookmark(b))
      }
    }
  }

  return result
}

async function tagBatch(
  bookmarks: TagInput[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()

  const items = bookmarks.map(b => {
    // Prefer the actual content (title + body) over the short excerpt, so tags
    // reflect the article — not site boilerplate (e.g. Wikipedia chrome).
    const header = b.title?.trim() ? b.title.trim() : b.text
    const parts: string[] = [`[${b.id}] ${header}`]
    const body = b.body?.trim()
    if (body) parts.push(`Content: ${body.slice(0, 2500)}`)
    if (b.entities) {
      const flat = parseEntityValues(b.entities).join(', ')
      if (flat) parts.push(`Entities: ${flat}`)
    }
    if (b.imageTags) {
      try {
        const tags = JSON.parse(b.imageTags) as unknown
        const strings = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
        if (strings.length > 0) {
          parts.push(`Image tags: ${strings.join(', ')}`)
        }
      } catch {}
    }
    return parts.join('\n')
  })

  const prompt = `For each item below, generate 8-15 lowercase hyphenated semantic tags that capture its SUBJECT MATTER — the specific topics, technologies, concepts, people, and themes the content is actually about.

Do NOT tag the host website or platform (e.g. never "wikipedia", "encyclopedia", "youtube", "blog"); tag the ideas, not where they live.

Return ONLY a JSON object where each key is the item ID and the value is an array of tag strings. No markdown, no explanation.

Items:
${items.join('\n\n---\n\n')}`

  const content = await llmChat([{ role: 'user', content: prompt }], {
    stage: 'tagging',
    maxTokens: 1500,
  })
  const cleaned = extractJson(content)

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    for (const b of bookmarks) {
      const tags = parsed[b.id]
      if (Array.isArray(tags)) {
        const cleaned = cleanTags((tags as unknown[]).filter(t => typeof t === 'string') as string[])
        result.set(b.id, cleaned.length > 0 ? cleaned : fallbackTagsForBookmark(b))
      } else {
        result.set(b.id, fallbackTagsForBookmark(b))
      }
    }
  } catch {
    for (const b of bookmarks) {
      result.set(b.id, fallbackTagsForBookmark(b))
    }
  }

  return result
}

export function fallbackTagsForBookmark(input: Pick<TagInput, 'text' | 'title' | 'body' | 'entities' | 'imageTags'>): string[] {
  const weighted = [
    input.title,
    input.title,
    input.text,
    input.body,
    parseEntityValues(input.entities ?? '').join(' '),
    parseImageTags(input.imageTags ?? '').join(' '),
  ].filter((part): part is string => Boolean(part && part.trim()))

  const counts = new Map<string, number>()
  for (const part of weighted) {
    for (const token of tagTokens(part)) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
    for (const phrase of phraseTags(part)) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 2)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
    .slice(0, 12)
}

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const cleaned = slugTag(tag)
    if (!cleaned || seen.has(cleaned) || PLATFORM_TAGS.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
    if (out.length >= 15) break
  }
  return out
}

function tagTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9+.#-]+/g)
    .map(slugTag)
    .filter(token => token.length >= 3 || SHORT_TAGS.has(token))
    .filter(token => !STOP_WORDS.has(token) && !PLATFORM_TAGS.has(token))
}

function phraseTags(text: string): string[] {
  const tokens = tagTokens(text).filter(token => token.length > 2)
  const phrases: string[] = []
  for (let i = 0; i < tokens.length - 1; i++) {
    const phrase = `${tokens[i]}-${tokens[i + 1]}`
    if (phrase.length <= 48) phrases.push(phrase)
  }
  return phrases
}

function slugTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9+]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function parseImageTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

const SHORT_TAGS = new Set(['ai', 'ml', 'ux', 'ui', 'llm', 'soc'])
const PLATFORM_TAGS = new Set(['youtube', 'youtu.be', 'podcasts.apple.com', 'apple', 'podcasts', 'wikipedia', 'blog'])
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before', 'being', 'can', 'com', 'could',
  'does', 'for', 'from', 'had', 'has', 'have', 'here', 'how', 'into', 'its', 'just', 'like', 'more', 'not',
  'now', 'off', 'one', 'our', 'out', 'over', 'should', 'that', 'the', 'their', 'then', 'there', 'these',
  'this', 'through', 'to', 'until', 'use', 'was', 'what', 'when', 'where', 'which', 'while', 'with', 'www',
  'you', 'your',
])

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
