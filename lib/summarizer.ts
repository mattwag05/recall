import { llmChat } from './ai-client'

export interface SummarizeInput {
  id: string
  text: string
  body: string | null
}

/**
 * Generates a 1-2 sentence summary for a card.
 * Uses full body text when available, falls back to the short text field.
 */
export async function summarizeBookmark(input: SummarizeInput): Promise<string> {
  const content = input.body?.trim() || input.text?.trim()
  if (!content) return ''

  const summary = await llmChat(
    [{ role: 'user', content: `Summarize this in 1-2 sentences:\n\n${content.slice(0, 8000)}` }],
    {
      stage: 'summarization',
      temperature: 0.2,
      maxTokens: 220,
      system:
        'You generate concise 1-2 sentence summaries of saved content. ' +
        'Be specific and factual — include key names, numbers, and concepts. ' +
        'Write in plain English. Never use phrases like "the content discusses" or "this article covers". ' +
        'Just state what it is directly. Maximum 3 sentences.',
    },
  )
  return summary.trim()
}

/**
 * Batch version — generates summaries for multiple bookmarks.
 * Uses concurrent requests with a concurrency limit to avoid rate limiting.
 */
export async function summarizeBookmarks(
  inputs: SummarizeInput[],
  onProgress?: (current: number, total: number) => void,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const concurrency = 5

  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency)
    const summaries = await Promise.all(
      batch.map(async (input) => {
        try {
          const summary = await summarizeBookmark(input)
          return { id: input.id, summary }
        } catch {
          return { id: input.id, summary: '' }
        }
      }),
    )

    for (const s of summaries) {
      if (s.summary) results.set(s.id, s.summary)
    }

    onProgress?.(Math.min(i + concurrency, inputs.length), inputs.length)
  }

  return results
}
