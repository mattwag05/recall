import { llmChat } from './ai-client'

export interface NotebookInput {
  id: string
  title: string | null
  text: string
  body: string | null
}

/**
 * Generates a card's "Notebook" — a structured, editable markdown summary
 * (Recall's signature view). Distinct from the 1-line `summary` preview.
 *
 * Output is markdown with a short TL;DR followed by key-point bullets and,
 * when the source is long enough, themed sub-sections. The result is stored in
 * `Bookmark.notebookContent` and is user-editable; regeneration is explicit.
 */
export async function generateNotebook(input: NotebookInput): Promise<string> {
  const content = input.body?.trim() || input.text?.trim()
  if (!content) return ''

  const title = input.title?.trim() || input.text?.slice(0, 120) || 'Untitled'

  const md = await llmChat(
    [
      {
        role: 'user',
        content:
          `Title: ${title}\n\nContent:\n${content.slice(0, 12000)}\n\n` +
          'Write the notebook now.',
      },
    ],
    {
      stage: 'notebook',
      temperature: 0.3,
      maxTokens: 1200,
      system:
        'You are a knowledge-base note-taker. Produce a clean, structured Markdown summary of the content for later review. ' +
        'Format exactly:\n' +
        '## TL;DR\nOne or two crisp sentences capturing the core point.\n\n' +
        '## Key points\n- 4 to 8 specific, factual bullets (names, numbers, claims, definitions).\n\n' +
        '## Notes\n- Any caveats, open questions, or notable details (optional; omit the section if nothing fits).\n\n' +
        'Rules: be specific and concrete; preserve key terminology; no preamble, no "this article"; ' +
        'output ONLY the Markdown, starting with "## TL;DR".',
    },
  )
  const cleaned = md.trim()
  return isUsableNotebook(cleaned) ? cleaned : ''
}

export function fallbackNotebook(input: NotebookInput): string {
  const content = (input.body?.trim() || input.text?.trim() || '').replace(/\s+/g, ' ')
  const title = input.title?.trim() || input.text?.slice(0, 120) || 'Untitled'
  const summary = firstUsefulSentence(content) || title
  const points = keyPoints(content, summary)
  return [
    '## TL;DR',
    summary,
    '',
    '## Key points',
    ...points.map(point => `- ${point}`),
    '',
    '## Notes',
    '- Generated locally from extracted text because the local model did not return a structured notebook in time.',
  ].join('\n').trim()
}

/**
 * Pull the TL;DR out of a generated notebook to use as the 1-line card summary —
 * keeps the preview consistent with the notebook and saves a separate LLM call.
 * Returns '' if no TL;DR section is found.
 */
export function extractTldr(notebook: string): string {
  if (!notebook) return ''
  const m = notebook.match(/##\s*TL;?DR\s*\n+([\s\S]*?)(?:\n##\s|\n#\s|$)/i)
  if (!m) return ''
  return m[1]
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

/** Batch helper with limited concurrency. */
export async function generateNotebooks(
  inputs: NotebookInput[],
  onProgress?: (current: number, total: number) => void,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const concurrency = 3 // single local LLM — keep it gentle
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency)
    const out = await Promise.all(
      batch.map(async (input) => {
        try {
          return { id: input.id, md: await generateNotebook(input) }
        } catch {
          return { id: input.id, md: '' }
        }
      }),
    )
    for (const o of out) if (o.md) results.set(o.id, o.md)
    onProgress?.(Math.min(i + concurrency, inputs.length), inputs.length)
  }
  return results
}

function firstUsefulSentence(content: string): string {
  const sentence = content.split(/(?<=[.!?])\s+/).find(part => part.trim().length >= 40)?.trim() || content.trim()
  return sentence.length > 320 ? `${sentence.slice(0, 317).trimEnd()}...` : sentence
}

function keyPoints(content: string, summary: string): string[] {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(part => part.length >= 30 && part !== summary)
    .slice(0, 5)
    .map(part => part.length > 220 ? `${part.slice(0, 217).trimEnd()}...` : part)
  return sentences.length > 0 ? sentences : [summary]
}

function isUsableNotebook(markdown: string): boolean {
  const lower = markdown.toLowerCase()
  if (!lower.includes('## tl;dr') && !lower.includes('## tl:dr') && !lower.includes('## tldr')) return false
  return ![
    'one or two crisp sentences capturing the core point',
    'i apologize',
    'cannot fulfill',
    'cannot assist',
    'current capabilities are limited',
    'as an ai',
  ].some(marker => lower.includes(marker))
}
