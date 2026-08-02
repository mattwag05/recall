export interface CardTag {
  name: string
  slug: string
  color: string
}

export interface CardListItem {
  id: string
  title: string
  provider: string | null
  url: string
  summary: string | null
  status: string
  triageStatus?: string
  sourceType: string
  thumbnail: string | null
  shared: boolean
  createdAt: string
  updatedAt: string
  tags: CardTag[]
  /** Cards that link TO this one. Absent on payloads that don't count it. */
  inboundCount?: number
}

export interface CardDetail extends CardListItem {
  shareId: string | null
  readerContent: string
  /** LLM-tidied Reader markdown, persisted server-side. Empty when never run. */
  readerReformatted?: string
  notebookContent: string
  notes: string
  readTime: number | null
  semanticTags: string[]
  categories: CardTag[]
  connections: CardConnection[]
  incomingConnections: CardConnection[]
  quizQuestions: CardQuizQuestion[]
  quizQuestionCount: number
}

export interface RelatedCard extends CardListItem {
  score: number
}

export interface CardGraph {
  rootId: string
  depth: number
  cards: CardGraphCard[]
  entities: CardGraphEntity[]
  edges: CardGraphEdge[]
}

export interface CardGraphCard {
  id: string
  title: string
  provider: string | null
  url: string
  depth: number
}

export interface CardGraphEntity {
  id: string
  label: string
  entityType: string
  origin: string
  fromCardId: string
  depth: number
}

export interface CardGraphEdge {
  id: string
  fromId: string
  toId: string
  label: string
  entityType: string
  origin: string
  depth: number
}

export interface ChatCitation {
  cardId: string
  title: string
  provider: string | null
  url: string
  summary: string | null
  marker: string
  score: number | null
}

export interface ChatAnswer {
  threadId: string
  answer: string
  citations: ChatCitation[]
  warning?: string
}

export interface ChatAttachment {
  name: string
  type: string | null
  text: string
  size: number | null
}

export interface ChatMessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: ChatCitation[]
  createdAt: string
}

export interface ChatThreadDetail {
  id: string
  title: string | null
  scope: 'global' | 'card' | 'tag'
  cardIds: string[]
  tagSlugs: string[]
  messages: ChatMessageItem[]
}

export interface ChatThreadSummary {
  id: string
  title: string | null
  scope: 'global' | 'card' | 'tag'
  cardIds: string[]
  tagSlugs: string[]
  updatedAt: string
  lastMessage: string | null
}

export interface CardConnection {
  id: string
  entityType: string
  label: string
  origin: string
  createdAt: string
  from: {
    id: string
    title: string | null
    text: string
    provider: string | null
    postUrl: string
  } | null
  to: {
    id: string
    title: string | null
    text: string
    provider: string | null
    postUrl: string
  } | null
}

export interface CardQuizQuestion {
  id: string
  prompt: string
  answer: string
  type: string
  options?: string[]
  origin: string
  memoryStage: string
  dueAt: string | null
  lastReviewed: string | null
  timesSeen: number
  timesCorrect: number
}

export interface TagNode {
  id: string
  name: string
  slug: string
  color: string
  parentId: string | null
  count: number
  children: TagNode[]
}

export type LibraryOrder = 'updated' | 'created' | 'inbound' | 'alpha'
export type LibraryDirection = 'asc' | 'desc'
export type LibraryGroup = 'day' | 'week' | 'month' | 'none'
export type LibraryView = 'grid' | 'list' | 'table'

export interface LibraryFilters {
  /** Window on the ordering date field. */
  date: 'all' | 'today' | 'week' | 'month'
  /** Exact `provider` value, or null for every source. */
  source: string | null
  shared: 'all' | 'shared' | 'private'
  /** Tag slugs; a card matches if it carries ANY of them. Empty = no filter. */
  tags: string[]
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = { date: 'all', source: null, shared: 'all', tags: [] }

export function dateFieldFor(order: LibraryOrder): 'createdAt' | 'updatedAt' {
  return order === 'created' ? 'createdAt' : 'updatedAt'
}

const DAY_MS = 86400000

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Group cards into date buckets at the requested granularity.
 * 'day' is the original Today / Yesterday / weekday / date behavior.
 * 'none' returns a single unlabelled bucket (callers skip the header).
 */
export function groupByDate(
  cards: CardListItem[],
  dateField: 'createdAt' | 'updatedAt' = 'createdAt',
  granularity: LibraryGroup = 'day',
  now: Date = new Date()
): { label: string; cards: CardListItem[] }[] {
  if (granularity === 'none') return cards.length ? [{ label: '', cards }] : []

  const today = startOfDay(now)
  const thisWeek = startOfWeek(now)
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  const buckets = new Map<string, CardListItem[]>()
  const order: string[] = []
  const push = (label: string, c: CardListItem) => {
    if (!buckets.has(label)) { buckets.set(label, []); order.push(label) }
    buckets.get(label)!.push(c)
  }

  for (const c of cards) {
    const iso = c[dateField]
    const date = new Date(iso)
    let label: string
    if (granularity === 'week') {
      const start = startOfWeek(date)
      if (start === thisWeek) label = 'This week'
      else if (start === thisWeek - 7 * DAY_MS) label = 'Last week'
      else label = `Week of ${new Date(start).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
    } else if (granularity === 'month') {
      const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
      label = start === thisMonth
        ? 'This month'
        : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    } else {
      const t = startOfDay(date)
      if (t === today) label = 'Today'
      else if (t === today - DAY_MS) label = 'Yesterday'
      else if (today - t < DAY_MS * 7) label = date.toLocaleDateString(undefined, { weekday: 'long' })
      else label = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    }
    push(label, c)
  }
  return order.map(label => ({ label, cards: buckets.get(label)! }))
}

/** Sunday-anchored week start, as a local-midnight timestamp. */
function startOfWeek(d: Date): number {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  start.setDate(start.getDate() - start.getDay())
  return start.getTime()
}

/**
 * Order cards. Pinned cards float to the top of whatever ordering is active,
 * in both directions — pinning is a user statement, not a sort key.
 */
export function sortCards(
  cards: CardListItem[],
  order: LibraryOrder,
  direction: LibraryDirection = 'desc'
): CardListItem[] {
  const flip = direction === 'asc' ? -1 : 1
  return [...cards].sort((a, b) => {
    const pinDelta = Number(b.triageStatus === 'pinned') - Number(a.triageStatus === 'pinned')
    if (pinDelta !== 0) return pinDelta
    if (order === 'alpha') return flip * b.title.localeCompare(a.title)
    if (order === 'inbound') return flip * ((b.inboundCount ?? 0) - (a.inboundCount ?? 0))
    const field = dateFieldFor(order)
    return flip * (new Date(b[field]).getTime() - new Date(a[field]).getTime())
  })
}

/** Client-side filter bar. Every clause composes; empty clauses pass everything. */
export function filterCards(
  cards: CardListItem[],
  filters: LibraryFilters,
  order: LibraryOrder = 'updated',
  now: Date = new Date()
): CardListItem[] {
  const since = filters.date === 'today' ? startOfDay(now)
    : filters.date === 'week' ? startOfDay(now) - 7 * DAY_MS
    : filters.date === 'month' ? startOfDay(now) - 30 * DAY_MS
    : null
  const field = dateFieldFor(order)
  const tags = new Set(filters.tags)

  return cards.filter(card => {
    if (since !== null && new Date(card[field]).getTime() < since) return false
    if (filters.source !== null && (card.provider ?? '') !== filters.source) return false
    if (filters.shared === 'shared' && !card.shared) return false
    if (filters.shared === 'private' && card.shared) return false
    if (tags.size > 0 && !card.tags.some(t => tags.has(t.slug))) return false
    return true
  })
}

/** Distinct non-empty providers present in a card list, alphabetical. */
export function cardSources(cards: CardListItem[]): string[] {
  return [...new Set(cards.map(c => c.provider).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b))
}

/**
 * Expand tag slugs to include their descendants, so filtering by a parent tag
 * matches cards tagged only with a child (mirrors the server's `?tag=` subtree).
 */
export function tagSubtreeSlugs(nodes: TagNode[], slugs: string[]): string[] {
  const wanted = new Set(slugs)
  const out = new Set(slugs)
  const walk = (list: TagNode[], inside: boolean) => {
    for (const node of list) {
      const within = inside || wanted.has(node.slug)
      if (within) out.add(node.slug)
      walk(node.children, within)
    }
  }
  walk(nodes, false)
  return [...out]
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
