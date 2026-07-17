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
  sourceType: string
  thumbnail: string | null
  shared: boolean
  createdAt: string
  updatedAt: string
  tags: CardTag[]
}

export interface CardDetail extends CardListItem {
  shareId: string | null
  readerContent: string
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

/** Group cards into Today / Yesterday / weekday / older buckets. */
export function groupByDate(
  cards: CardListItem[],
  dateField: 'createdAt' | 'updatedAt' = 'createdAt'
): { label: string; cards: CardListItem[] }[] {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = startOfDay(now)
  const day = 86400000

  const buckets = new Map<string, CardListItem[]>()
  const order: string[] = []
  const push = (label: string, c: CardListItem) => {
    if (!buckets.has(label)) { buckets.set(label, []); order.push(label) }
    buckets.get(label)!.push(c)
  }

  for (const c of cards) {
    const iso = c[dateField]
    const t = startOfDay(new Date(iso))
    let label: string
    if (t === today) label = 'Today'
    else if (t === today - day) label = 'Yesterday'
    else if (today - t < day * 7) label = new Date(iso).toLocaleDateString(undefined, { weekday: 'long' })
    else label = new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    push(label, c)
  }
  return order.map(label => ({ label, cards: buckets.get(label)! }))
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
