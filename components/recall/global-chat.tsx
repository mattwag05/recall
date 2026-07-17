'use client'

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'
import type { ChatAnswer, ChatMessageItem, ChatThreadDetail, ChatThreadSummary } from '@/lib/recall-types'
import { ChatAttachmentControl, type ChatAttachmentDraft } from './chat-attachments'
import type { ChatCardContext, ChatTagContext } from './chat-context-preview'

type ContextTab = 'tags' | 'cards'

const CONTEXT_TABS: { id: ContextTab; label: string }[] = [
  { id: 'tags', label: 'Tags' },
  { id: 'cards', label: 'Cards' },
]

export function GlobalChat({
  tags,
  cards,
  threads,
}: {
  tags: ChatTagContext[]
  cards: ChatCardContext[]
  threads: ChatThreadSummary[]
}) {
  const [tab, setTab] = useState<ContextTab>('tags')
  const [selectedTagSlugs, setSelectedTagSlugs] = useState<string[]>([])
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingThread, setLoadingThread] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [includeSemantic, setIncludeSemantic] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachmentDraft[]>([])
  const canSend = prompt.trim().length > 0 && !sending

  function focusTab(next: ContextTab) {
    setTab(next)
    window.setTimeout(() => document.getElementById(globalContextTabId(next))?.focus(), 0)
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, current: ContextTab) {
    const index = CONTEXT_TABS.findIndex(item => item.id === current)
    if (index < 0) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab(CONTEXT_TABS[(index + 1) % CONTEXT_TABS.length].id)
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab(CONTEXT_TABS[(index - 1 + CONTEXT_TABS.length) % CONTEXT_TABS.length].id)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusTab(CONTEXT_TABS[0].id)
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusTab(CONTEXT_TABS[CONTEXT_TABS.length - 1].id)
    }
  }

  async function sendChat() {
    const trimmed = prompt.trim()
    if (!trimmed || sending) return
    const userMessage: ChatMessageItem = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      citations: [],
      createdAt: new Date().toISOString(),
    }
    setMessages(current => [...current, userMessage])
    setPrompt('')
    setSending(true)
    setChatError(null)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          scope: chatScope(selectedCardIds, selectedTagSlugs),
          cardIds: selectedCardIds,
          tagSlugs: selectedTagSlugs,
          threadId,
          includeSemantic,
          attachments,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiError(data, 'Could not answer from local knowledge'))
      if (!isChatAnswerResponse(data)) throw new Error('The local chat API returned an unexpected response')
      setThreadId(data.threadId)
      setMessages(current => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.answer,
          citations: data.citations,
          createdAt: new Date().toISOString(),
        },
      ])
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Could not answer from local knowledge')
      setPrompt(trimmed)
    } finally {
      setSending(false)
    }
  }

  async function loadThread(id: string) {
    setLoadingThread(id)
    setChatError(null)
    try {
      const res = await fetch(`/api/chat?threadId=${encodeURIComponent(id)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiError(data, 'Could not load chat thread'))
      if (!isChatThreadResponse(data)) throw new Error('The local chat API returned an unexpected thread response')
      setThreadId(data.thread.id)
      setMessages(data.thread.messages)
      setSelectedCardIds(data.thread.cardIds)
      setSelectedTagSlugs(data.thread.tagSlugs)
      setAttachments([])
      setPrompt('')
      setHistoryOpen(false)
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Could not load chat thread')
    } finally {
      setLoadingThread(null)
    }
  }

  function newThread() {
    setThreadId(null)
    setMessages([])
    setPrompt('')
    setChatError(null)
    setAttachments([])
  }

  return (
    <div>
      <section className="py-6 rr-rule">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="rr-mono">Context</div>
          <div className="flex flex-wrap gap-2">
            <label className="rr-tag inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeSemantic}
                onChange={event => setIncludeSemantic(event.currentTarget.checked)}
                className="accent-[var(--accent)]"
              />
              Semantic search
            </label>
            <button className="rr-tag" type="button" onClick={() => setHistoryOpen(open => !open)} aria-expanded={historyOpen} aria-controls="global-chat-history">
              History
            </button>
            <ChatAttachmentControl
              attachments={attachments}
              disabled={sending}
              onAdd={drafts => setAttachments(current => [...current, ...drafts])}
              onRemove={id => setAttachments(current => current.filter(attachment => attachment.id !== id))}
              buttonClassName="rr-tag inline-flex items-center gap-2"
              label="Upload temporary global chat context"
            />
          </div>
        </div>

        {historyOpen && (
          <div id="global-chat-history" className="mt-4 rr-card p-4" style={{ borderRadius: 3 }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display" style={{ fontSize: '1.05rem', fontWeight: 500 }}>Recent chats</h2>
              <button className="rr-mono rr-link" type="button" onClick={newThread}>New chat</button>
            </div>
            <div className="mt-3 space-y-2">
              {threads.length > 0 ? threads.map(thread => (
                <button
                  key={thread.id}
                  className="block w-full text-left rr-rule py-2"
                  onClick={() => void loadThread(thread.id)}
                  disabled={loadingThread === thread.id}
                  type="button"
                >
                  <span className="font-display block" style={{ fontSize: '1rem', overflowWrap: 'anywhere' }}>{thread.title || 'Untitled chat'}</span>
                  <span className="rr-mono">{loadingThread === thread.id ? 'loading…' : thread.lastMessage || thread.scope}</span>
                </button>
              )) : <p className="rr-prose">No saved chats yet.</p>}
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2" role="tablist" aria-label="Global chat context">
          {CONTEXT_TABS.map(item => (
            <button
              key={item.id}
              id={globalContextTabId(item.id)}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={globalContextPanelId(item.id)}
              tabIndex={tab === item.id ? 0 : -1}
              className="rr-tag"
              onClick={() => setTab(item.id)}
              onKeyDown={event => onTabKeyDown(event, item.id)}
              style={tab === item.id ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div id={globalContextPanelId(tab)} role="tabpanel" aria-labelledby={globalContextTabId(tab)} className="mt-4">
          {tab === 'tags' ? (
            <ContextChecklist
              empty="No tags yet."
              items={tags.map(tag => ({ id: tag.slug, label: tag.path, meta: tag.count ? `${tag.count}` : '', color: tag.color }))}
              selected={selectedTagSlugs}
              onToggle={slug => setSelectedTagSlugs(current => toggleValue(current, slug))}
            />
          ) : (
            <ContextChecklist
              empty="No cards yet."
              items={cards.map(card => ({ id: card.id, label: card.title, meta: card.source }))}
              selected={selectedCardIds}
              onToggle={id => setSelectedCardIds(current => toggleValue(current, id))}
            />
          )}
        </div>
      </section>

      <section className="py-8">
        <div className="space-y-4" aria-live="polite">
          {messages.map(message => (
            <ChatMessageBlock key={message.id} message={message} />
          ))}
        </div>

        {chatError && (
          <div className="rr-card mt-4 p-4" style={{ borderRadius: 3 }}>
            <p className="rr-prose" style={{ fontSize: '0.94rem' }}>{chatError}</p>
          </div>
        )}

        <form
          className="mt-5"
          onSubmit={event => {
            event.preventDefault()
            void sendChat()
          }}
        >
          <label className="rr-mono" htmlFor="global-chat-prompt">Composer</label>
          <textarea
            id="global-chat-prompt"
            aria-label="Global chat prompt"
            rows={5}
            value={prompt}
            onChange={event => setPrompt(event.currentTarget.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void sendChat()
              }
            }}
            placeholder="What would you like to know?"
            className="mt-3 w-full bg-transparent px-3 py-2 outline-none rr-prose"
            style={{ border: '1px solid var(--hairline)', resize: 'vertical', borderRadius: 3 }}
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ContextSummary selectedCards={selectedCardIds.length} selectedTags={selectedTagSlugs.length} selectedAttachments={attachments.length} threadId={threadId} />
            <button className="rr-btn rr-btn-accent" disabled={!canSend} type="submit">
              {sending ? 'Answering…' : 'Send'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ContextChecklist({
  items,
  selected,
  onToggle,
  empty,
}: {
  items: { id: string; label: string; meta: string; color?: string }[]
  selected: string[]
  onToggle: (id: string) => void
  empty: string
}) {
  if (items.length === 0) return <p className="rr-prose">{empty}</p>
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map(item => (
        <label key={item.id} className="rr-card flex min-w-0 items-start gap-2 p-3" style={{ borderRadius: 3 }}>
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            onChange={() => onToggle(item.id)}
            className="mt-1 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="rr-link block" style={{ color: item.color, overflowWrap: 'anywhere' }}>{item.label}</span>
            {item.meta && <span className="rr-mono">{item.meta}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

function ChatMessageBlock({ message }: { message: ChatMessageItem }) {
  return (
    <div className="rr-card p-4" style={{ borderRadius: 3 }}>
      <p className="rr-mono" style={{ color: message.role === 'assistant' ? 'var(--accent)' : 'var(--sepia)' }}>
        {message.role === 'assistant' ? 'Recall' : 'You'}
      </p>
      <p className="rr-prose mt-2 whitespace-pre-wrap" style={{ fontSize: '0.95rem' }}>{message.content}</p>
      {message.citations.length > 0 && (
        <div className="mt-4 rr-rule pt-3">
          <p className="rr-mono">Sources</p>
          <div className="mt-2 flex flex-col gap-2">
            {message.citations.map(citation => (
              <Link key={`${message.id}-${citation.marker}`} href={`/item/${citation.cardId}`} className="rr-link">
                <span className="rr-mono">[{citation.marker}]</span>{' '}
                <span style={{ overflowWrap: 'anywhere' }}>{citation.title}</span>
                {typeof citation.score === 'number' && <span className="rr-mono"> · {Math.round(citation.score * 100)}%</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ContextSummary({ selectedCards, selectedTags, selectedAttachments, threadId }: { selectedCards: number; selectedTags: number; selectedAttachments: number; threadId: string | null }) {
  const parts = []
  if (selectedTags > 0) parts.push(`${selectedTags} ${selectedTags === 1 ? 'tag' : 'tags'}`)
  if (selectedCards > 0) parts.push(`${selectedCards} ${selectedCards === 1 ? 'card' : 'cards'}`)
  if (selectedAttachments > 0) parts.push(`${selectedAttachments} temporary ${selectedAttachments === 1 ? 'file' : 'files'}`)
  if (parts.length === 0) parts.push('all knowledge')
  if (threadId) parts.push('saved thread')
  return <span className="rr-mono">{parts.join(' · ')}</span>
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value]
}

function chatScope(cardIds: string[], tagSlugs: string[]): 'global' | 'card' | 'tag' {
  if (tagSlugs.length > 0) return 'tag'
  if (cardIds.length > 0) return 'card'
  return 'global'
}

function isChatAnswerResponse(data: unknown): data is { ok: true } & ChatAnswer {
  if (!data || typeof data !== 'object' || !('ok' in data) || (data as { ok?: unknown }).ok !== true) return false
  const record = data as Record<string, unknown>
  return typeof record.threadId === 'string' &&
    typeof record.answer === 'string' &&
    Array.isArray(record.citations)
}

function isChatThreadResponse(data: unknown): data is { thread: ChatThreadDetail } {
  if (!data || typeof data !== 'object' || !('thread' in data)) return false
  const thread = (data as { thread?: unknown }).thread
  return !!thread &&
    typeof thread === 'object' &&
    typeof (thread as { id?: unknown }).id === 'string' &&
    Array.isArray((thread as { messages?: unknown }).messages)
}

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error
  }
  return fallback
}

function globalContextTabId(tab: ContextTab): string {
  return `global-chat-context-tab-${tab}`
}

function globalContextPanelId(tab: ContextTab): string {
  return `global-chat-context-panel-${tab}`
}
