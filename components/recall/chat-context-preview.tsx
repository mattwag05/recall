'use client'

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'

type ContextTab = 'tags' | 'cards'

const CONTEXT_TABS: { id: ContextTab; label: string }[] = [
  { id: 'tags', label: 'Tags' },
  { id: 'cards', label: 'Cards' },
]

export type ChatTagContext = {
  slug: string
  path: string
  color: string
  count: number
}

export type ChatCardContext = {
  id: string
  title: string
  source: string
}

export function ChatContextPreview({
  tags,
  cards,
}: {
  tags: ChatTagContext[]
  cards: ChatCardContext[]
}) {
  const [tab, setTab] = useState<ContextTab>('tags')

  function focusTab(next: ContextTab) {
    setTab(next)
    window.setTimeout(() => document.getElementById(contextTabId(next))?.focus(), 0)
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: ContextTab) {
    const currentIndex = CONTEXT_TABS.findIndex(item => item.id === current)
    if (currentIndex < 0) return

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusTab(CONTEXT_TABS[(currentIndex + 1) % CONTEXT_TABS.length].id)
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusTab(CONTEXT_TABS[(currentIndex - 1 + CONTEXT_TABS.length) % CONTEXT_TABS.length].id)
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusTab(CONTEXT_TABS[0].id)
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusTab(CONTEXT_TABS[CONTEXT_TABS.length - 1].id)
    }
  }

  return (
    <section className="py-6 rr-rule">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="rr-mono">Context picker</div>
        <div className="flex gap-2" role="tablist" aria-label="Chat context">
          {CONTEXT_TABS.map(item => (
            <button
              key={item.id}
              id={contextTabId(item.id)}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={contextPanelId(item.id)}
              tabIndex={tab === item.id ? 0 : -1}
              className="rr-tag"
              onClick={() => setTab(item.id)}
              onKeyDown={e => onTabKeyDown(e, item.id)}
              style={tab === item.id ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div id={contextPanelId(tab)} role="tabpanel" aria-labelledby={contextTabId(tab)} className="mt-4">
        {tab === 'tags' ? <TagContextPanel tags={tags} /> : <CardContextPanel cards={cards} />}
      </div>
    </section>
  )
}

function TagContextPanel({ tags }: { tags: ChatTagContext[] }) {
  return (
    <div>
      <h2 className="font-display" style={{ fontSize: '1.1rem', fontWeight: 500 }}>Tags</h2>
      <div className="mt-3 space-y-2">
        {tags.length > 0 ? tags.map(tag => (
          <div key={tag.slug} className="flex min-w-0 items-baseline justify-between gap-3 rr-rule py-1">
            <span className="rr-link min-w-0" style={{ color: tag.color, overflowWrap: 'anywhere' }}>
              {tag.path}
            </span>
            <span className="rr-mono shrink-0">{tag.count || ''}</span>
          </div>
        )) : <p className="rr-prose">No tags yet.</p>}
      </div>
    </div>
  )
}

function CardContextPanel({ cards }: { cards: ChatCardContext[] }) {
  return (
    <div>
      <h2 className="font-display" style={{ fontSize: '1.1rem', fontWeight: 500 }}>Recent cards</h2>
      <div className="mt-3 space-y-3">
        {cards.length > 0 ? cards.map(card => (
          <Link key={card.id} href={`/item/${card.id}`} className="block rr-link">
            <span className="font-display block" style={{ fontSize: '1rem', overflowWrap: 'anywhere' }}>{card.title}</span>
            <span className="rr-mono">{card.source}</span>
          </Link>
        )) : <p className="rr-prose">No cards yet.</p>}
      </div>
    </div>
  )
}

function contextTabId(tab: ContextTab): string {
  return `chat-context-tab-${tab}`
}

function contextPanelId(tab: ContextTab): string {
  return `chat-context-panel-${tab}`
}
