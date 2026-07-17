export interface ExportableCard {
  title: string | null
  text: string
  provider: string | null
  postUrl: string
  summary: string | null
  notebookContent: string | null
  body: string | null
  notes: string | null
  importedAt: Date
  semanticTags: string | null
  categories: { category: { name: string } }[]
  connectionsOut?: {
    entityType: string
    label: string
    origin: string
    to?: { title: string | null; text: string } | null
  }[]
  quizQuestions?: {
    prompt: string
    answer: string
    type: string
    origin: string
    memoryStage: string
  }[]
}

/** Render a single card to Markdown (metadata + saved card content). */
export function cardToMarkdown(c: ExportableCard): string {
  const title = c.title || c.text.slice(0, 120) || 'Untitled'
  const lines: string[] = [`# ${escapeMarkdownInline(title)}`, '']

  const meta: string[] = []
  if (c.provider) meta.push(`**Source:** ${escapeMarkdownInline(c.provider)}`)
  if (c.postUrl) meta.push(`**URL:** ${c.postUrl}`)
  meta.push(`**Saved:** ${new Date(c.importedAt).toISOString().slice(0, 10)}`)
  lines.push(meta.join('  \n'), '')

  const tags = c.categories.map(x => x.category.name)
  const semantic = parseSemanticTags(c.semanticTags)
  const allTags = uniqueTags([...tags, ...semantic])
  if (allTags.length) lines.push(`**Tags:** ${allTags.map(t => `#${slugifyTag(t)}`).join(' ')}`, '')

  if (c.summary) lines.push(blockquote(c.summary), '')

  if (c.notebookContent) {
    lines.push('## Notebook', '', c.notebookContent.trim(), '')
  }
  if (c.notes) {
    lines.push('## My notes', '', c.notes.trim(), '')
  }
  if (c.body) {
    lines.push('## Reader', '', c.body.trim(), '')
  }
  if (c.connectionsOut?.length) {
    lines.push('## Connections', '')
    for (const connection of c.connectionsOut) {
      const target = connection.to ? ` -> ${escapeMarkdownInline(connection.to.title || connection.to.text.slice(0, 80) || 'Untitled')}` : ''
      lines.push(`- **${escapeMarkdownInline(connection.entityType)}:** ${escapeMarkdownInline(connection.label)}${target} _(${escapeMarkdownInline(connection.origin)})_`)
    }
    lines.push('')
  }
  if (c.quizQuestions?.length) {
    lines.push('## Quiz Questions', '')
    for (const question of c.quizQuestions) {
      lines.push(`- **${escapeMarkdownInline(question.prompt)}**`)
      lines.push(`  - Answer: ${escapeMarkdownInline(question.answer)}`)
      lines.push(`  - Type: ${escapeMarkdownInline(question.type)} - Stage: ${escapeMarkdownInline(question.memoryStage)} - Origin: ${escapeMarkdownInline(question.origin)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'card'
  )
}

function escapeMarkdownInline(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+!|])/g, '\\$1').replace(/\s+/g, ' ').trim()
}

function blockquote(text: string): string {
  return text
    .trim()
    .split(/\n+/)
    .map(line => `> ${escapeMarkdownInline(line)}`)
    .join('\n')
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim()
    const slug = slugifyTag(tag)
    if (!tag || !slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(tag)
  }
  return out
}

function parseSemanticTags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
