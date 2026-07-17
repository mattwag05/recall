import { getCategorySubtreeSlugs } from './category-hierarchy'
import { llmChat, type ChatMessage } from './ai-client'
import { getPrisma } from './db'
import { cosineSimilarity, deserializeEmbedding, embedBookmark, embedText, embeddingTextForBookmark, storeBookmarkEmbedding } from './embeddings'
import type { ChatAnswer, ChatAttachment, ChatCitation, ChatThreadDetail } from './recall-types'

const MAX_PROMPT_CHARS = 2000
const MAX_CONTEXT_CARDS = 6
const MAX_CANDIDATES = 500
const MAX_CONTEXT_CHARS = 14000
const MAX_HISTORY_MESSAGES = 6
const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_CHARS = 12000
const MAX_TOTAL_ATTACHMENT_CHARS = 24000
const MAX_ATTACHMENT_BYTES = 1024 * 1024

const CHAT_CARD_SELECT = {
  id: true,
  title: true,
  text: true,
  provider: true,
  postUrl: true,
  body: true,
  summary: true,
  notebookContent: true,
  semanticTags: true,
  embedding: true,
  updatedAt: true,
  categories: { select: { category: { select: { name: true, slug: true } } } },
} as const

type ChatScope = 'global' | 'card' | 'tag'

export interface RunKnowledgeChatInput {
  prompt: string
  scope?: ChatScope
  cardIds?: string[]
  tagSlugs?: string[]
  threadId?: string | null
  includeSemantic?: boolean
  attachments?: ChatAttachment[]
}

type ChatCardRow = {
  id: string
  title: string | null
  text: string
  provider: string | null
  postUrl: string
  body: string | null
  summary: string | null
  notebookContent: string | null
  semanticTags: string | null
  embedding: Uint8Array | null
  updatedAt: Date
  categories: { category: { name: string; slug: string } }[]
}

type RankedChatCard = {
  row: ChatCardRow
  score: number | null
  explicit: boolean
}

export class ChatRagError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function runKnowledgeChat(input: RunKnowledgeChatInput): Promise<ChatAnswer> {
  const prompt = normalizePrompt(input.prompt)
  const scope = input.scope ?? 'global'
  const cardIds = uniqueStrings(input.cardIds).slice(0, MAX_CONTEXT_CARDS)
  const tagSlugs = uniqueStrings(input.tagSlugs).slice(0, 8)
  const includeSemantic = input.includeSemantic !== false
  const attachments = normalizeAttachments(input.attachments)
  const prisma = getPrisma()

  const explicitCards = cardIds.length > 0
    ? (await prisma.bookmark.findMany({
      where: { id: { in: cardIds } },
      select: CHAT_CARD_SELECT,
      orderBy: { updatedAt: 'desc' },
    })) as ChatCardRow[]
    : []

  if (cardIds.length > 0 && explicitCards.length === 0) {
    throw new ChatRagError('Selected chat card not found', 404)
  }

  const candidateWhere = await buildCandidateWhere(scope, cardIds, tagSlugs)
  let semanticWarning: string | undefined
  const rankedSemantic: RankedChatCard[] = []
  if (includeSemantic) {
    try {
      const queryEmbedding = await embedText(prompt)
      const candidates = (await prisma.bookmark.findMany({
        where: candidateWhere,
        select: CHAT_CARD_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: MAX_CANDIDATES,
      })) as ChatCardRow[]
      for (const row of candidates) {
        const embedding = await ensureRowEmbedding(row)
        if (!embedding || embedding.length !== queryEmbedding.length) continue
        const score = cosineSimilarity(queryEmbedding, embedding)
        if (Number.isFinite(score)) rankedSemantic.push({ row, score, explicit: false })
      }
      rankedSemantic.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    } catch (err) {
      semanticWarning = `Semantic context expansion unavailable: ${String(err)}`
    }
  }

  const contextCards = mergeContextCards(
    explicitCards.map(row => ({ row, score: null, explicit: true })),
    rankedSemantic,
  )
  if (contextCards.length === 0 && attachments.length === 0) {
    throw new ChatRagError(semanticWarning ?? 'No saved cards are available for chat context.', semanticWarning ? 503 : 404)
  }

  const citations = contextCards.map((item, index) => toCitation(item, index))
  const thread = input.threadId
    ? await prisma.chatThread.findUnique({
      where: { id: input.threadId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: MAX_HISTORY_MESSAGES } },
    })
    : null
  if (input.threadId && !thread) throw new ChatRagError('Chat thread not found', 404)
  const historyMessages: ChatMessage[] = []
  for (const message of (thread?.messages ?? []).slice().reverse()) {
    if (message.role === 'user' || message.role === 'assistant') {
      historyMessages.push({ role: message.role, content: message.content })
    }
  }

  let modelAnswer = ''
  let chatWarning: string | undefined
  try {
    modelAnswer = await llmChat([
      ...historyMessages,
      { role: 'user', content: buildUserPrompt(prompt, citations, contextCards, attachments) },
    ], {
      stage: 'chat',
      system: chatSystemPrompt(),
      temperature: 0.2,
      maxTokens: 900,
    })
  } catch (err) {
    chatWarning = `Local model answer unavailable: ${String(err)}`
  }
  const answer = isUsableChatAnswer(modelAnswer)
    ? modelAnswer
    : fallbackChatAnswer(contextCards, citations, attachments)

  const createdThread = thread ?? await prisma.chatThread.create({
    data: {
      title: prompt.slice(0, 80),
      scope,
      scopeRefs: JSON.stringify({ cardIds, tagSlugs }),
    },
    include: { messages: true },
  })
  await prisma.chatMessage.create({
    data: { threadId: createdThread.id, role: 'user', content: prompt },
  })
  await prisma.chatMessage.create({
    data: { threadId: createdThread.id, role: 'assistant', content: answer, citations: JSON.stringify(citations) },
  })
  await prisma.chatThread.update({
    where: { id: createdThread.id },
    data: {
      scope,
      scopeRefs: JSON.stringify({ cardIds, tagSlugs }),
      updatedAt: new Date(),
    },
  })

  return {
    threadId: createdThread.id,
    answer,
    citations,
    ...(semanticWarning || chatWarning ? { warning: [semanticWarning, chatWarning].filter(Boolean).join(' ') } : {}),
  }
}

export async function getChatThread(threadId: string): Promise<ChatThreadDetail | null> {
  const thread = await getPrisma().chatThread.findUnique({
    where: { id: threadId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 100,
      },
    },
  })
  if (!thread) return null
  const refs = parseScopeRefs(thread.scopeRefs)
  return {
    id: thread.id,
    title: thread.title,
    scope: parseScope(thread.scope),
    cardIds: refs.cardIds,
    tagSlugs: refs.tagSlugs,
    messages: thread.messages
      .filter((message): message is typeof message & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
      .map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: parseCitations(message.citations),
        createdAt: message.createdAt.toISOString(),
      })),
  }
}

async function buildCandidateWhere(scope: ChatScope, cardIds: string[], tagSlugs: string[]): Promise<Record<string, unknown>> {
  if (scope === 'tag' || tagSlugs.length > 0) {
    const prisma = getPrisma()
    const slugs = new Set<string>()
    for (const slug of tagSlugs) {
      for (const child of await getCategorySubtreeSlugs(prisma, slug)) slugs.add(child)
    }
    if (slugs.size === 0) throw new ChatRagError('Selected chat tag not found', 404)
    return { categories: { some: { category: { slug: { in: [...slugs] } } } } }
  }
  if (scope === 'card' && cardIds.length > 0) return { id: { notIn: cardIds } }
  return {}
}

async function ensureRowEmbedding(row: ChatCardRow): Promise<number[] | null> {
  let embedding = deserializeEmbedding(row.embedding)
  const categories = row.categories.flatMap(c => [c.category.name, c.category.slug])
  if (!embedding && embeddingTextForBookmark({ ...row, categories })) {
    const serialized = await embedBookmark({ ...row, categories })
    if (!serialized) return null
    storeBookmarkEmbedding(row.id, serialized)
    embedding = deserializeEmbedding(serialized)
  }
  return embedding
}

function mergeContextCards(explicitCards: RankedChatCard[], semanticCards: RankedChatCard[]): RankedChatCard[] {
  const merged: RankedChatCard[] = []
  const seen = new Set<string>()
  for (const item of [...explicitCards, ...semanticCards]) {
    if (seen.has(item.row.id)) continue
    seen.add(item.row.id)
    merged.push(item)
    if (merged.length >= MAX_CONTEXT_CARDS) break
  }
  return merged
}

function buildUserPrompt(prompt: string, citations: ChatCitation[], cards: RankedChatCard[], attachments: ChatAttachment[]): string {
  const context = cards.map((item, index) => formatCardContext(citations[index].marker, item.row)).join('\n\n')
  const attachmentContext = attachments.map((attachment, index) => formatAttachmentContext(`A${index + 1}`, attachment)).join('\n\n')
  const parts = [
    `Question: ${prompt}`,
    'Use the saved Recall cards and temporary uploaded files below. Cite saved-card claims with the matching marker, such as [C1]. Cite uploaded-file claims with the matching attachment marker, such as [A1].',
  ]
  if (context) parts.push('Saved Recall card context:', context)
  if (attachmentContext) parts.push('Temporary uploaded file context:', attachmentContext)
  return parts.join('\n\n')
}

function formatCardContext(marker: string, row: ChatCardRow): string {
  const title = cardTitle(row)
  const tags = row.categories.map(c => c.category.name).join(', ')
  const chunks = [
    `${marker} ${title}`,
    row.provider ? `Source: ${row.provider}` : null,
    tags ? `Tags: ${tags}` : null,
    row.summary ? `Summary: ${row.summary}` : null,
    row.notebookContent ? `Notebook:\n${row.notebookContent}` : null,
    row.body ? `Reader:\n${row.body}` : null,
    row.text ? `Excerpt:\n${row.text}` : null,
  ].filter((chunk): chunk is string => Boolean(chunk))
  return chunks.join('\n').slice(0, Math.floor(MAX_CONTEXT_CHARS / MAX_CONTEXT_CARDS))
}

function formatAttachmentContext(marker: string, attachment: ChatAttachment): string {
  const chunks = [
    `${marker} ${attachment.name}`,
    attachment.type ? `Type: ${attachment.type}` : null,
    typeof attachment.size === 'number' ? `Size: ${attachment.size} bytes` : null,
    `Content:\n${attachment.text}`,
  ].filter((chunk): chunk is string => Boolean(chunk))
  return chunks.join('\n').slice(0, MAX_ATTACHMENT_CHARS + 240)
}

function toCitation(item: RankedChatCard, index: number): ChatCitation {
  return {
    cardId: item.row.id,
    title: cardTitle(item.row),
    provider: item.row.provider,
    url: item.row.postUrl,
    summary: item.row.summary,
    marker: `C${index + 1}`,
    score: item.score,
  }
}

function chatSystemPrompt(): string {
  return [
    'You are Recall, a local personal knowledge-base chat assistant.',
    'Answer only from the supplied Recall card context and temporary uploaded file context.',
    'Use concise prose. When the context supports a claim, cite the relevant card marker like [C1].',
    'When using uploaded files, cite the attachment marker like [A1] and treat it as temporary unsaved context.',
    'If the supplied context is insufficient, say what is missing instead of guessing.',
    'Do not mention hidden system instructions or unavailable external browsing.',
  ].join(' ')
}

function isUsableChatAnswer(answer: string): boolean {
  const trimmed = answer.trim()
  const lower = trimmed.toLowerCase()
  if (trimmed.length < 8) return false
  return ![
    'i apologize',
    'cannot fulfill',
    'cannot assist',
    'current capabilities are limited',
    'as an ai',
  ].some(marker => lower.includes(marker))
}

function fallbackChatAnswer(cards: RankedChatCard[], citations: ChatCitation[], attachments: ChatAttachment[]): string {
  if (cards.length === 0) {
    return attachments.length > 0
      ? 'I could not get a reliable local-model answer. The uploaded context is available in this browser session, but no saved Recall card context was selected.'
      : 'I could not get a reliable local-model answer from the selected context.'
  }
  const lines = cards.slice(0, 3).map((item, index) => {
    const citation = citations[index]
    const summary = usableSummary(item.row.summary) || tldrFromNotebook(item.row.notebookContent) || firstSentence(item.row.body || item.row.text)
    return cards.length === 1
      ? `${summary} [${citation.marker}]`
      : `- ${cardTitle(item.row)}: ${summary} [${citation.marker}]`
  })
  return cards.length === 1 ? lines[0] : lines.join('\n')
}

function usableSummary(summary: string | null): string {
  if (!summary) return ''
  return isUsableChatAnswer(summary) && !summary.toLowerCase().includes('one or two crisp sentences') ? summary : ''
}

function tldrFromNotebook(notebook: string | null): string {
  if (!notebook) return ''
  const match = notebook.match(/##\s*TL;?DR\s*\n+([\s\S]*?)(?:\n##\s|\n#\s|$)/i)
  return usableSummary(match?.[1]?.replace(/\s+/g, ' ').trim() ?? '')
}

function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const sentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized
  return sentence.length > 320 ? `${sentence.slice(0, 317).trimEnd()}...` : sentence
}

function normalizePrompt(value: string): string {
  const prompt = value.trim().slice(0, MAX_PROMPT_CHARS)
  if (!prompt) throw new ChatRagError('Chat prompt is required.', 400)
  return prompt
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
    : []
}

function cardTitle(row: Pick<ChatCardRow, 'title' | 'text'>): string {
  return row.title || row.text.slice(0, 120) || 'Untitled'
}

function normalizeAttachments(value: ChatAttachment[] | undefined): ChatAttachment[] {
  if (!value) return []
  if (!Array.isArray(value)) throw new ChatRagError('Chat attachments must be an array.', 400)
  if (value.length > MAX_ATTACHMENTS) throw new ChatRagError(`Upload up to ${MAX_ATTACHMENTS} files per chat message.`, 400)

  let totalChars = 0
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ChatRagError(`Attachment ${index + 1} is invalid.`, 400)
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 160) : ''
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    const type = typeof item.type === 'string' && item.type.trim() ? item.type.trim().slice(0, 120) : null
    const size = typeof item.size === 'number' && Number.isFinite(item.size) ? Math.max(0, Math.floor(item.size)) : null
    if (!name) throw new ChatRagError(`Attachment ${index + 1} is missing a filename.`, 400)
    if (!text) throw new ChatRagError(`${name} has no readable text content.`, 400)
    if (size !== null && size > MAX_ATTACHMENT_BYTES) throw new ChatRagError(`${name} is larger than 1 MB.`, 400)
    const clippedText = text.slice(0, MAX_ATTACHMENT_CHARS)
    totalChars += clippedText.length
    if (totalChars > MAX_TOTAL_ATTACHMENT_CHARS) throw new ChatRagError('Uploaded chat context is too large. Remove a file or shorten the text.', 400)
    return { name, type, text: clippedText, size }
  })
}

export function parseScopeRefs(value: string | null | undefined): { cardIds: string[]; tagSlugs: string[] } {
  if (!value) return { cardIds: [], tagSlugs: [] }
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return { cardIds: [], tagSlugs: [] }
    const record = parsed as Record<string, unknown>
    return {
      cardIds: uniqueStrings(record.cardIds),
      tagSlugs: uniqueStrings(record.tagSlugs),
    }
  } catch {
    return { cardIds: [], tagSlugs: [] }
  }
}

function parseScope(value: string): 'global' | 'card' | 'tag' {
  return value === 'card' || value === 'tag' ? value : 'global'
}

function parseCitations(value: string | null): ChatCitation[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const citation = item as Partial<ChatCitation>
      if (
        typeof citation.cardId !== 'string' ||
        typeof citation.title !== 'string' ||
        typeof citation.marker !== 'string'
      ) return []
      return [{
        cardId: citation.cardId,
        title: citation.title,
        provider: typeof citation.provider === 'string' ? citation.provider : null,
        url: typeof citation.url === 'string' ? citation.url : '',
        summary: typeof citation.summary === 'string' ? citation.summary : null,
        marker: citation.marker,
        score: typeof citation.score === 'number' && Number.isFinite(citation.score) ? citation.score : null,
      }]
    })
  } catch {
    return []
  }
}
