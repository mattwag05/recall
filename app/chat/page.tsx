import Link from 'next/link'
import { getPrisma } from '@/lib/db'
import { GlobalChat } from '@/components/recall/global-chat'
import { type ChatCardContext, type ChatTagContext } from '@/components/recall/chat-context-preview'
import { parseScopeRefs } from '@/lib/chat-rag'
import type { ChatThreadSummary } from '@/lib/recall-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function ChatPage() {
  const prisma = getPrisma()
  const [cards, tags, threads] = await Promise.all([
    prisma.bookmark.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: { id: true, title: true, text: true, provider: true, sourceType: true, updatedAt: true },
    }),
    prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        parentId: true,
        bookmarks: { select: { bookmarkId: true } },
      },
    }),
    prisma.chatThread.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        title: true,
        scope: true,
        scopeRefs: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
    }),
  ])
  const tagContexts = buildTagContexts(tags).slice(0, 16)
  const cardContexts: ChatCardContext[] = cards.map(card => ({
    id: card.id,
    title: card.title || card.text.slice(0, 80) || 'Untitled',
    source: card.provider ?? card.sourceType,
  }))
  const threadSummaries: ChatThreadSummary[] = threads.map(thread => {
    const refs = parseScopeRefs(thread.scopeRefs)
    return {
      id: thread.id,
      title: thread.title,
      scope: thread.scope === 'card' || thread.scope === 'tag' ? thread.scope : 'global',
      cardIds: refs.cardIds,
      tagSlugs: refs.tagSlugs,
      updatedAt: thread.updatedAt.toISOString(),
      lastMessage: thread.messages[0]?.content?.slice(0, 160) ?? null,
    }
  })

  return (
    <div className="mx-auto max-w-3xl px-6 md:px-10 pb-24">
      <header className="flex flex-col gap-3 pt-10 pb-5 rr-rule sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="rr-mono" style={{ color: 'var(--gold)' }}>Phase 2 route</p>
          <h1 className="font-display" style={{ fontSize: '2.2rem', fontWeight: 500 }}>Chat with your knowledge</h1>
        </div>
        <Link href="/items" className="rr-mono rr-link">← Library</Link>
      </header>

      <GlobalChat tags={tagContexts} cards={cardContexts} threads={threadSummaries} />
    </div>
  )
}

type CategoryRow = {
  id: string
  name: string
  slug: string
  color: string
  parentId: string | null
  bookmarks: { bookmarkId: string }[]
}

type TagContext = ChatTagContext & {
  slug: string
  path: string
  color: string
  count: number
}

function buildTagContexts(rows: CategoryRow[]): TagContext[] {
  const byId = new Map(rows.map(row => [row.id, { ...row, children: [] as CategoryRow[] }]))
  const roots: Array<CategoryRow & { children: CategoryRow[] }> = []

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node)
    else roots.push(node)
  }

  const contexts: TagContext[] = []
  const visit = (node: CategoryRow & { children: CategoryRow[] }, trail: string[]) => {
    const path = [...trail, node.name]
    const ids = collectBookmarkIds(node)
    contexts.push({ slug: node.slug, path: path.join(' / '), color: node.color, count: ids.size })
    for (const child of node.children) visit(child as CategoryRow & { children: CategoryRow[] }, path)
  }

  for (const root of roots) visit(root, [])
  return contexts.sort((a, b) => a.path.localeCompare(b.path))
}

function collectBookmarkIds(node: CategoryRow & { children?: CategoryRow[] }): Set<string> {
  const ids = new Set(node.bookmarks.map(bookmark => bookmark.bookmarkId))
  for (const child of node.children ?? []) {
    for (const id of collectBookmarkIds(child as CategoryRow & { children?: CategoryRow[] })) ids.add(id)
  }
  return ids
}
