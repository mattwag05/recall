'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { BookOpen, Bot, Brain, Bug, CheckSquare, ChevronDown, ChevronRight, Circle, Clock, Command, Cpu, FileQuestion, FileText, HelpCircle, Image as ImageIcon, Inbox, LayoutGrid, Link2, List, Mail, MessageCircle, MessageCircleQuestion, MoreHorizontal, Network, Plus, Search, Settings, Sparkles, Star, Tags, UserCircle, type LucideIcon } from 'lucide-react'
import { AddContentModal, type AddContentTab, type SavedContentMeta } from './add-content-modal'
import { SearchModal } from './search-modal'
import { toast } from './toaster'
import { groupByDate, relativeTime, type CardListItem, type TagNode } from '@/lib/recall-types'

async function fetchCards(tag: string | null) {
  const res = await fetch(`/api/cards${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load cards')
  if (!Array.isArray(data.cards)) {
    throw new Error('The local card API returned an unexpected response. Try again instead of trusting an empty library.')
  }
  return data.cards as CardListItem[]
}

async function fetchTags() {
  const res = await fetch('/api/tags')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load tags')
  if (!Array.isArray(data.tags)) {
    throw new Error('The local tag API returned an unexpected response.')
  }
  return data.tags as TagNode[]
}

type LibrarySort = 'updated' | 'created'
type LibraryView = 'grid' | 'list'

const LIBRARY_VIEWS: { id: LibraryView; label: string; icon: LucideIcon }[] = [
  { id: 'grid', label: 'Grid', icon: LayoutGrid },
  { id: 'list', label: 'List', icon: List },
]

export function Library() {
  const [cards, setCards] = useState<CardListItem[]>([])
  const [tags, setTags] = useState<TagNode[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addInitialTab, setAddInitialTab] = useState<AddContentTab>('url')
  const [searchOpen, setSearchOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set())
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<LibrarySort>('updated')
  const [viewMode, setViewMode] = useState<LibraryView>('list')
  const [tagSidebarOpen, setTagSidebarOpen] = useState(true)
  const [profileOpen, setProfileOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const profileButtonRef = useRef<HTMLButtonElement | null>(null)

  const loadCards = useCallback(async (tag: string | null) => {
    try {
      const nextCards = await fetchCards(tag)
      setCards(nextCards)
      setLibraryError(null)
    } catch (err) {
      setLibraryError(errorMessage(err, 'Could not load the library. Check that Recall is still running, then try again.'))
    } finally {
      setLoaded(true)
    }
  }, [])

  const loadTags = useCallback(async () => {
    try {
      setTags(await fetchTags())
      setTagError(null)
    } catch (err) {
      setTagError(errorMessage(err, 'Could not load tag filters. Existing cards are still available; retry tags when the local app is ready.'))
    }
  }, [])

  useEffect(() => {
    loadCards(activeTag)
  }, [activeTag, loadCards])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  // Poll while any card is still processing (organizing/summarizing).
  useEffect(() => {
    const processing = cards.some(c => c.status === 'organizing' || c.status === 'summarizing')
    if (processing && !pollRef.current) {
      pollRef.current = setInterval(() => { loadCards(activeTag); loadTags() }, 4000)
    } else if (!processing && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [cards, activeTag, loadCards, loadTags])

  // Keyboard: "/" search, "n" new — suppressed while any modal/menu is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcutTarget(e.target)) return
      if (addOpen || searchOpen || profileOpen) return
      if (e.key === '/') { e.preventDefault(); setSearchOpen(true) }
      if (e.key === 'n') { e.preventDefault(); setAddInitialTab('url'); setAddOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, searchOpen, profileOpen])

  useEffect(() => {
    if (!profileOpen) return
    window.setTimeout(() => focusFirstProfileMenuItem(profileMenuRef.current), 0)
    const onPointerDown = (e: PointerEvent) => {
      if (!profileMenuRef.current?.contains(e.target as Node)) setProfileOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProfileOpen(false)
        profileButtonRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [profileOpen])

  function onProfileMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setProfileOpen(false)
      profileButtonRef.current?.focus()
      return
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()

    const items = profileMenuItems(profileMenuRef.current)
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)

    if (e.key === 'Home') {
      items[0].focus()
      return
    }
    if (e.key === 'End') {
      items[items.length - 1].focus()
      return
    }

    const nextIndex = e.key === 'ArrowDown'
      ? (currentIndex + 1) % items.length
      : (currentIndex - 1 + items.length) % items.length
    items[nextIndex].focus()
  }

  const sortedCards = sortCards(cards, sortMode)
  const groups = groupByDate(sortedCards, sortMode === 'created' ? 'createdAt' : 'updatedAt')
  const flatTags = flattenTags(tags)
  const visibleTags = filterTagTree(tags, tagQuery)
  const expandableTagIds = collectExpandableTagIds(tags)
  const activeTagLabel = activeTag ? flatTags.find(t => t.slug === activeTag)?.label ?? activeTag : 'All cards'
  const visibleCardIds = sortedCards.map(card => card.id)
  const selectedCardCount = selectedCards.size
  const readyCount = cards.filter(card => card.status === 'ready').length
  const processingCount = cards.filter(card => card.status === 'organizing' || card.status === 'summarizing').length
  const failedCount = cards.filter(card => card.status === 'failed').length
  const reviewDueEstimate = cards.filter(card => card.tags.some(tag => /review|quiz|memory|learning/i.test(tag.name))).length
  const topTags = flatTags.filter(tag => tag.count > 0).sort((a, b) => b.count - a.count).slice(0, 7)
  const recentCards = sortedCards.slice(0, 4)

  function openAdd(tab: AddContentTab = 'url') {
    setAddInitialTab(tab)
    setAddOpen(true)
  }

  function toggleTagBranch(id: string) {
    setCollapsedTags(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function collapseAllTags() {
    setCollapsedTags(new Set(expandableTagIds))
  }

  function expandAllTags() {
    setCollapsedTags(new Set())
  }

  function toggleSelectedTag(slug: string) {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function toggleSelectedCard(id: string) {
    setSelectedCards(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisibleCards() {
    setSelectedCards(new Set(visibleCardIds))
  }

  function clearSelectedCards() {
    setSelectedCards(new Set())
  }

  function focusViewMode(next: LibraryView) {
    setViewMode(next)
    window.setTimeout(() => document.getElementById(libraryViewModeId(next))?.focus(), 0)
  }

  function onViewModeKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: LibraryView) {
    const currentIndex = LIBRARY_VIEWS.findIndex(item => item.id === current)
    if (currentIndex < 0) return

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusViewMode(LIBRARY_VIEWS[(currentIndex + 1) % LIBRARY_VIEWS.length].id)
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusViewMode(LIBRARY_VIEWS[(currentIndex - 1 + LIBRARY_VIEWS.length) % LIBRARY_VIEWS.length].id)
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusViewMode(LIBRARY_VIEWS[0].id)
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusViewMode(LIBRARY_VIEWS[LIBRARY_VIEWS.length - 1].id)
    }
  }

  function pickTag(slug: string | null) {
    setActiveTag(slug)
    setSelectedCards(new Set())
  }

  function savedMessage(meta: SavedContentMeta) {
    if (meta.message) return meta.message
    if (meta.skipped) return 'Already in library'
    if (meta.status === 'failed') return 'Saved as failed — open card to retry extraction'
    if (meta.status === 'ready') return 'Saved'
    if (meta.kind === 'note' && meta.status === 'organizing') return 'Saved — organizing note…'
    if (meta.kind === 'wiki' && meta.status === 'organizing') return 'Wikipedia topic imported — summarizing on your local model…'
    if (meta.kind === 'pdf' && meta.status === 'organizing') return 'PDF imported — summarizing on your local model…'
    if (meta.kind === 'image' && meta.status === 'organizing') return 'Image imported — summarizing OCR/vision text…'
    if (meta.kind === 'markdown' && meta.status === 'organizing') return 'Markdown imported — summarizing on your local model…'
    if (meta.kind === 'bookmarks' && meta.status === 'organizing') return 'Browser bookmarks imported — summarizing on your local model…'
    if (meta.kind === 'pocket' && meta.status === 'organizing') return 'Pocket links imported — summarizing on your local model…'
    if (meta.kind === 'social-bookmarks' && meta.status === 'organizing') return 'Social Bookmarks imported — summarizing on your local model…'
    return 'Saved — summarizing on your local model…'
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <div className="grid min-h-screen lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <ShellNav
          cardCount={cards.length}
          readyCount={readyCount}
          reviewDueEstimate={reviewDueEstimate}
          activeTag={activeTag}
          activeTagLabel={activeTagLabel}
          tagsVisible={tagSidebarOpen}
          onToggleTags={() => setTagSidebarOpen(open => !open)}
          tagQuery={tagQuery}
          setTagQuery={setTagQuery}
          selectedTagCount={selectedTags.size}
          clearSelectedTags={() => setSelectedTags(new Set())}
          visibleTags={visibleTags}
          flatTags={flatTags}
          onPickTag={pickTag}
          collapsedTags={tagQuery ? new Set() : collapsedTags}
          onToggleTagBranch={toggleTagBranch}
          selectedTags={selectedTags}
          onToggleSelectedTag={toggleSelectedTag}
          expandableTagCount={expandableTagIds.length}
          expandAllTags={expandAllTags}
          collapseAllTags={collapseAllTags}
        />

        <div className="min-w-0 border-x border-[var(--hairline)] bg-white/85 backdrop-blur-sm">
          <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-[var(--hairline)] bg-white/90 px-4 backdrop-blur md:px-6">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--paper)] px-3 py-2 text-left text-sm text-[var(--sepia)] transition hover:border-slate-300 hover:bg-white"
              onClick={() => setSearchOpen(true)}
              aria-label="Search your library or ask Recall"
            >
              <Search size={16} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Search your library, ask anything, or run a command...</span>
              <kbd className="rounded-md border border-[var(--hairline)] bg-white px-1.5 py-0.5 font-mono text-[0.68rem] text-[var(--sepia)]">/</kbd>
            </button>
            <button className="rr-btn rr-btn-accent rr-btn-icon shrink-0" onClick={() => openAdd('url')}>
              <Plus size={15} aria-hidden="true" />
              <span>Add</span>
            </button>
            <div className="relative" ref={profileMenuRef}>
              <button
                ref={profileButtonRef}
                type="button"
                className="rr-btn rr-btn-icon shrink-0"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-controls={profileOpen ? 'profile-menu' : undefined}
                onClick={() => setProfileOpen(open => !open)}
              >
                <UserCircle size={15} aria-hidden="true" />
                <span className="hidden sm:inline">Profile</span>
              </button>
              {profileOpen && <ProfileMenu onKeyDown={onProfileMenuKeyDown} />}
            </div>
            <span className="hidden h-2.5 w-2.5 rounded-full bg-[var(--success)] shadow-[0_0_0_4px_rgba(34,197,94,0.12)] xl:block" aria-label="Local sync active" />
          </header>

          <MobileTagFilter tags={flatTags} active={activeTag} onPick={pickTag} />

          <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
            <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h1 className="text-2xl font-semibold leading-tight md:text-3xl">Library</h1>
                <p className="mt-2 text-sm text-[var(--sepia)]">
                  {cards.length.toLocaleString()} items · {activeTagLabel} · {processingCount > 0 ? `${processingCount} processing` : 'Local sync active'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rr-btn rr-btn-icon rr-desktop-only"
                  aria-controls="tag-sidebar"
                  aria-pressed={tagSidebarOpen}
                  onClick={() => setTagSidebarOpen(open => !open)}
                  title={tagSidebarOpen ? 'Hide collections' : 'Show collections'}
                  style={tagSidebarOpen ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                >
                  <Tags size={15} aria-hidden="true" />
                  <span>Collections</span>
                </button>
                <select
                  aria-label="Sort cards"
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value as LibrarySort)}
                  className="rr-select"
                >
                  <option value="updated">Recently updated</option>
                  <option value="created">Recently added</option>
                </select>
                <div className="flex items-center gap-1" role="radiogroup" aria-label="View mode">
                  {LIBRARY_VIEWS.map(option => {
                    const Icon = option.icon
                    const selected = viewMode === option.id
                    return (
                      <button
                        key={option.id}
                        id={libraryViewModeId(option.id)}
                        type="button"
                        role="radio"
                        className="rr-btn rr-btn-icon"
                        onClick={() => setViewMode(option.id)}
                        onKeyDown={e => onViewModeKeyDown(e, option.id)}
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        style={selected ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: '#eff6ff' } : undefined}
                      >
                        <Icon size={14} aria-hidden="true" />
                        <span>{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <QuickTile icon={Link2} label="Link" hint="article or media" onClick={() => openAdd('url')} />
              <QuickTile icon={FileText} label="Note" hint="private thought" onClick={() => openAdd('note')} />
              <QuickTile icon={ImageIcon} label="Image" hint="OCR capture" onClick={() => openAdd('image')} />
              <QuickTile icon={BookOpen} label="Wiki" hint="topic import" onClick={() => openAdd('wiki')} />
              <QuickTile icon={FileText} label="PDF" hint="document OCR" onClick={() => openAdd('pdf')} />
            </div>
            {libraryError && (
            <div className="rr-card mb-5 px-4 py-3" style={{ borderRadius: 8, borderColor: 'var(--danger)' }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="rr-prose" style={{ fontSize: '0.95rem' }}>{libraryError}</p>
                <button
                  type="button"
                  className="rr-btn rr-btn-accent shrink-0"
                  onClick={() => { loadCards(activeTag); loadTags() }}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {tagError && (
            <div className="rr-card mb-5 px-4 py-3" style={{ borderRadius: 8, borderColor: 'var(--warning)' }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="rr-prose" style={{ fontSize: '0.95rem' }}>{tagError}</p>
                <button
                  type="button"
                  className="rr-btn shrink-0"
                  onClick={loadTags}
                >
                  Retry tags
                </button>
              </div>
            </div>
          )}

          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--sepia)]">
                <button type="button" className="rounded-md bg-blue-50 px-3 py-1.5 font-medium text-[var(--accent)]">All</button>
                <button type="button" className="rounded-md px-3 py-1.5 font-medium hover:bg-[var(--paper)]">Unread</button>
                <button type="button" className="rounded-md px-3 py-1.5 font-medium hover:bg-[var(--paper)]">Favorites</button>
                <button type="button" className="rounded-md px-3 py-1.5 font-medium hover:bg-[var(--paper)]">Recently added</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rr-btn rr-btn-icon"
                  onClick={selectAllVisibleCards}
                  disabled={visibleCardIds.length === 0}
                  aria-label="Select all visible cards"
                >
                  <CheckSquare size={14} aria-hidden="true" />
                  <span>Select all</span>
                </button>
                <button
                  type="button"
                  className="rr-btn"
                  disabled={selectedCardCount === 0}
                  onClick={clearSelectedCards}
                  aria-label="Clear selected cards"
                >
                  Clear
                </button>
              </div>
            {selectedCardCount > 0 && (
              <div className="mt-3 flex flex-col gap-2 rr-rule pb-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="rr-mono" style={{ color: 'var(--accent)' }}>{selectedCardCount} selected</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rr-btn"
                    disabled
                    aria-label="Export selected cards as Markdown (planned)"
                    title="Batch Markdown export needs a selected-card export API."
                  >
                    Export selected
                  </button>
                  <button
                    type="button"
                    className="rr-btn"
                    disabled
                    aria-label="Delete selected cards (planned)"
                    title="Batch deletion needs confirmation and a selected-card delete API."
                  >
                    Delete selected
                  </button>
                </div>
              </div>
            )}
          </div>

          {!loaded && <p className="rr-mono">opening the archive…</p>}
          {loaded && !libraryError && cards.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--card-edge)] bg-white px-6 py-16 text-center">
              <p className="font-display text-xl font-semibold">Your library is empty.</p>
              <p className="rr-prose mt-2">Save your first article, transcript, note, or PDF to start building local memory.</p>
              <button className="rr-btn rr-btn-accent rr-btn-icon mt-5 mx-auto" onClick={() => openAdd('url')}>
                <Plus size={15} aria-hidden="true" />
                <span>Add something</span>
              </button>
            </div>
          )}

          {groups.map((group, gi) => (
            <section key={group.label} className="mb-9">
              <div className="mb-3 flex items-center justify-between">
                <div className="rr-mono" style={{ color: 'var(--sepia)' }}>{group.label}</div>
                <div className="rr-mono">{group.cards.length} items</div>
              </div>
              {viewMode === 'grid' ? (
                <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                  {group.cards.map((c, i) => (
                    <CardGridTile
                      key={c.id}
                      card={c}
                      index={gi * 6 + i}
                      selected={selectedCards.has(c.id)}
                      onToggleSelected={toggleSelectedCard}
                    />
                  ))}
                </div>
              ) : (
                <div>
                  {group.cards.map((c, i) => (
                    <CardRow
                      key={c.id}
                      card={c}
                      index={gi * 6 + i}
                      selected={selectedCards.has(c.id)}
                      onToggleSelected={toggleSelectedCard}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
          </div>
        </div>

        <InsightRail
          cards={cards}
          recentCards={recentCards}
          topTags={topTags}
          readyCount={readyCount}
          processingCount={processingCount}
          failedCount={failedCount}
          reviewDueEstimate={reviewDueEstimate}
        />
      </div>

      <AddContentModal
        key={`${addOpen ? 'open' : 'closed'}-${addInitialTab}`}
        open={addOpen}
        initialTab={addInitialTab}
        onClose={() => setAddOpen(false)}
        onSaved={(_id, meta) => { setAddOpen(false); toast(savedMessage(meta)); loadCards(activeTag); loadTags() }}
      />
      <SearchModal
        key={`${searchOpen ? 'open' : 'closed'}-${activeTag ?? 'all'}`}
        open={searchOpen}
        activeTag={activeTag}
        activeTagLabel={activeTagLabel}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  )
}

function isShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return !!target.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function flattenTags(nodes: TagNode[], trail: string[] = []): { slug: string; label: string; color: string; count: number }[] {
  return nodes.flatMap(n => {
    const path = [...trail, n.name]
    return [
      { slug: n.slug, label: path.join(' / '), color: n.color, count: n.count },
      ...flattenTags(n.children, path),
    ]
  })
}

function filterTagTree(nodes: TagNode[], query: string, trail: string[] = []): TagNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  return nodes.flatMap(node => {
    const path = [...trail, node.name].join(' / ')
    const children = filterTagTree(node.children, q, [...trail, node.name])
    const matches = node.name.toLowerCase().includes(q) || node.slug.toLowerCase().includes(q) || path.toLowerCase().includes(q)

    if (!matches && children.length === 0) return []
    return [{ ...node, children }]
  })
}

function collectExpandableTagIds(nodes: TagNode[]): string[] {
  return nodes.flatMap(node => [
    ...(node.children.length > 0 ? [node.id] : []),
    ...collectExpandableTagIds(node.children),
  ])
}

function libraryViewModeId(view: LibraryView): string {
  return `library-view-mode-${view}`
}

function sortCards(cards: CardListItem[], mode: LibrarySort): CardListItem[] {
  return [...cards].sort((a, b) => {
    const aDate = new Date(mode === 'created' ? a.createdAt : a.updatedAt).getTime()
    const bDate = new Date(mode === 'created' ? b.createdAt : b.updatedAt).getTime()
    return bDate - aDate
  })
}

function emptySummaryCopy(card: CardListItem): string {
  if (card.status === 'failed') return 'Could not extract readable content.'
  if (card.status === 'ready') {
    return card.sourceType === 'pasted' ? 'Title-only note.' : 'No summary saved yet.'
  }
  return 'Awaiting summary...'
}

function ShellNav({
  cardCount,
  readyCount,
  reviewDueEstimate,
  activeTag,
  activeTagLabel,
  tagsVisible,
  onToggleTags,
  tagQuery,
  setTagQuery,
  selectedTagCount,
  clearSelectedTags,
  visibleTags,
  onPickTag,
  collapsedTags,
  onToggleTagBranch,
  selectedTags,
  onToggleSelectedTag,
  expandableTagCount,
  expandAllTags,
  collapseAllTags,
}: {
  cardCount: number
  readyCount: number
  reviewDueEstimate: number
  activeTag: string | null
  activeTagLabel: string
  tagsVisible: boolean
  onToggleTags: () => void
  tagQuery: string
  setTagQuery: (value: string) => void
  selectedTagCount: number
  clearSelectedTags: () => void
  visibleTags: TagNode[]
  flatTags: { slug: string; label: string; color: string; count: number }[]
  onPickTag: (slug: string | null) => void
  collapsedTags: Set<string>
  onToggleTagBranch: (id: string) => void
  selectedTags: Set<string>
  onToggleSelectedTag: (slug: string) => void
  expandableTagCount: number
  expandAllTags: () => void
  collapseAllTags: () => void
}) {
  const navItems = [
    { label: 'Library', href: '/items', icon: BookOpen, meta: cardCount.toLocaleString(), active: true },
    { label: 'Chat', href: '/chat', icon: MessageCircle, meta: '⌘ J' },
    { label: 'Review', href: '/spaced-repetition', icon: Brain, meta: reviewDueEstimate ? String(reviewDueEstimate) : '0' },
    { label: 'Settings', href: '/settings', icon: Settings, meta: '⌘ ,' },
  ]

  return (
    <aside className="hidden min-h-screen border-r border-[var(--hairline)] bg-white/78 px-3 py-4 backdrop-blur lg:flex lg:flex-col">
      <div className="mb-8 flex items-center justify-between px-1">
        <Link href="/items" className="flex items-center gap-3" aria-label="Recall library">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-white shadow-[0_8px_24px_rgba(37,99,235,0.22)]">
            <Command size={17} aria-hidden="true" />
          </span>
          <span className="text-xl font-semibold">Recall</span>
        </Link>
        <button
          type="button"
          className="rounded-md p-1.5 text-[var(--sepia)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
          onClick={onToggleTags}
          aria-label={tagsVisible ? 'Hide collections' : 'Show collections'}
        >
          <ChevronRight size={15} aria-hidden="true" className={tagsVisible ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>

      <nav className="space-y-1" aria-label="Primary">
        {navItems.map(item => {
          const Icon = item.icon
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${item.active ? 'bg-blue-50 text-[var(--accent)]' : 'text-[var(--ink-soft)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'}`}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="font-mono text-xs text-[var(--sepia)]">{item.meta}</span>
            </Link>
          )
        })}
      </nav>

      {tagsVisible && (
        <section id="tag-sidebar" className="mt-6 min-h-0 flex-1 overflow-y-auto border-t border-[var(--hairline)] pt-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="rr-mono">Collections</div>
            <button
              type="button"
              disabled
              className="rounded-md p-1 text-[var(--sepia-2)]"
              aria-label="Create top-level tag (planned)"
              title="Top-level tag creation is planned; add tags from a card for now."
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>

          <button
            onClick={() => onPickTag(null)}
            className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium ${activeTag === null ? 'bg-blue-50 text-[var(--accent)]' : 'text-[var(--ink-soft)] hover:bg-[var(--paper)]'}`}
          >
            <span className="flex items-center gap-2"><Inbox size={15} aria-hidden="true" /> All items</span>
            <span className="font-mono text-xs text-[var(--sepia)]">{cardCount}</span>
          </button>
          <button
            onClick={() => onPickTag(null)}
            className="mb-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-[var(--ink-soft)] hover:bg-[var(--paper)]"
            title={activeTagLabel}
          >
            <span className="flex min-w-0 items-center gap-2"><Star size={15} aria-hidden="true" /> <span className="truncate">Ready</span></span>
            <span className="font-mono text-xs text-[var(--sepia)]">{readyCount}</span>
          </button>

          {selectedTagCount > 0 && (
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
              <div className="rr-mono text-[var(--accent)]">{selectedTagCount} selected</div>
              <button type="button" onClick={clearSelectedTags} className="mt-1 text-xs font-medium text-[var(--accent)]">Clear selection</button>
            </div>
          )}

          {expandableTagCount > 0 && (
            <div className="mb-3 flex items-center gap-3 text-xs font-medium text-[var(--sepia)]">
              <button type="button" onClick={expandAllTags} className="hover:text-[var(--accent)]">Expand</button>
              <button type="button" onClick={collapseAllTags} className="hover:text-[var(--accent)]">Collapse</button>
            </div>
          )}

          <label className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--hairline)] bg-white px-2">
            <Search size={13} aria-hidden="true" style={{ color: 'var(--sepia)' }} />
            <input
              aria-label="Filter tags"
              value={tagQuery}
              onChange={e => setTagQuery(e.target.value)}
              placeholder="Filter tags"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
            />
          </label>

          {visibleTags.length > 0 ? (
            <TagTree
              nodes={visibleTags}
              active={activeTag}
              onPick={onPickTag}
              depth={0}
              collapsed={collapsedTags}
              onToggle={onToggleTagBranch}
              selected={selectedTags}
              onToggleSelected={onToggleSelectedTag}
            />
          ) : (
            <p className="rr-mono py-2">No tags found</p>
          )}
        </section>
      )}

      <div className="mt-5 border-t border-[var(--hairline)] pt-4">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)] shadow-[0_0_0_4px_rgba(34,197,94,0.12)]" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Local sync active</span>
            <span className="block text-xs text-[var(--sepia)]">All data stays on this device</span>
          </span>
          <ChevronRight size={14} aria-hidden="true" className="text-[var(--sepia)]" />
        </div>
      </div>
    </aside>
  )
}

function InsightRail({
  cards,
  recentCards,
  topTags,
  readyCount,
  processingCount,
  failedCount,
  reviewDueEstimate,
}: {
  cards: CardListItem[]
  recentCards: CardListItem[]
  topTags: { slug: string; label: string; color: string; count: number }[]
  readyCount: number
  processingCount: number
  failedCount: number
  reviewDueEstimate: number
}) {
  return (
    <aside className="hidden min-h-screen bg-[var(--paper)] px-4 py-6 xl:block">
      <div className="sticky top-6 space-y-4">
        <RailPanel title="Today" action="Customize">
          <MetricRow icon={Plus} label="Items saved" value={cards.length} />
          <MetricRow icon={CheckSquare} label="Ready cards" value={readyCount} />
          <MetricRow icon={Clock} label="Processing" value={processingCount} />
          <MetricRow icon={Bug} label="Needs attention" value={failedCount} />
        </RailPanel>

        <RailPanel title="Related ideas" action="View all">
          {topTags.length > 0 ? topTags.slice(0, 4).map(tag => (
            <div key={tag.slug} className="flex items-start gap-3 py-2">
              <Network size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{tag.label}</div>
                <div className="mt-1 inline-flex rounded-md bg-[var(--paper)] px-2 py-0.5 font-mono text-xs text-[var(--sepia)]">{tag.count} cards</div>
              </div>
            </div>
          )) : (
            <p className="text-sm text-[var(--sepia)]">Save and tag cards to reveal local connections.</p>
          )}
        </RailPanel>

        <RailPanel title="Review due" action={String(reviewDueEstimate)}>
          <MetricRow icon={Star} label="Highlights" value={Math.max(0, reviewDueEstimate - 2)} />
          <MetricRow icon={Network} label="Note connections" value={Math.min(reviewDueEstimate, 7)} />
          <MetricRow icon={MessageCircle} label="Flashcards" value={Math.min(reviewDueEstimate, 4)} />
          <Link href="/spaced-repetition" className="rr-btn mt-3 w-full justify-between">
            <span>Start review</span>
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </RailPanel>

        <RailPanel title="Local AI status">
          <MetricRow icon={Bot} label="Model" value="Local" />
          <MetricRow icon={Cpu} label="Embeddings" value="Ready" />
          <MetricRow icon={Circle} label="Status" value={processingCount > 0 ? 'Running' : 'Idle'} />
          <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            All active features run locally.
          </div>
        </RailPanel>

        {recentCards.length > 0 && (
          <RailPanel title="Recent">
            <div className="space-y-2">
              {recentCards.map(card => (
                <Link key={card.id} href={`/item/${card.id}`} className="block rounded-lg px-2 py-1.5 hover:bg-white">
                  <span className="block truncate text-sm font-medium">{card.title}</span>
                  <span className="block font-mono text-xs text-[var(--sepia)]">{relativeTime(card.updatedAt)}</span>
                </Link>
              ))}
            </div>
          </RailPanel>
        )}
      </div>
    </aside>
  )
}

function RailPanel({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--hairline)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="rr-mono text-[var(--ink)]">{title}</h2>
        {action && <span className="text-xs font-medium text-[var(--accent)]">{action}</span>}
      </div>
      {children}
    </section>
  )
}

function MetricRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <Icon size={15} aria-hidden="true" className="shrink-0 text-[var(--sepia)]" />
      <span className="min-w-0 flex-1 truncate text-[var(--ink-soft)]">{label}</span>
      <span className="font-medium text-[var(--ink)]">{value}</span>
    </div>
  )
}

function MobileTagFilter({
  tags,
  active,
  onPick,
}: {
  tags: { slug: string; label: string; color: string; count: number }[]
  active: string | null
  onPick: (slug: string | null) => void
}) {
  if (tags.length === 0) return null
  return (
    <div className="md:hidden pt-4">
      <div className="mb-2 flex items-center gap-2 rr-mono">
        <Tags size={13} aria-hidden="true" />
        Tags
      </div>
      <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-2">
        <button
          onClick={() => onPick(null)}
          className="rr-tag shrink-0"
          style={{ borderColor: active === null ? 'var(--accent)' : undefined, color: active === null ? 'var(--accent)' : undefined }}
        >
          All cards
        </button>
        {tags.map(t => (
          <button
            key={t.slug}
            onClick={() => onPick(t.slug)}
            className="rr-tag shrink-0"
            style={{ borderColor: active === t.slug ? t.color : undefined, color: active === t.slug ? t.color : undefined }}
            title={`${t.label} (${t.count})`}
          >
            {t.label} {t.count ? `(${t.count})` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}

function TagTree({
  nodes,
  active,
  onPick,
  depth,
  collapsed,
  onToggle,
  selected,
  onToggleSelected,
}: {
  nodes: TagNode[]
  active: string | null
  onPick: (s: string) => void
  depth: number
  collapsed: Set<string>
  onToggle: (id: string) => void
  selected: Set<string>
  onToggleSelected: (slug: string) => void
}) {
  if (!nodes.length) return null
  return (
    <div style={{ paddingLeft: depth ? 12 : 0 }}>
      {nodes.map(n => {
        const hasChildren = n.children.length > 0
        const isCollapsed = collapsed.has(n.id)
        return (
          <div key={n.id}>
            <div className="flex items-center gap-1">
              <input
                type="checkbox"
                aria-label={`Select tag ${n.name}`}
                checked={selected.has(n.slug)}
                onChange={() => onToggleSelected(n.slug)}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
              />
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggle(n.id)}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${n.name} tag branch`}
                  className="rr-link flex h-5 w-5 shrink-0 items-center justify-center"
                  style={{ color: 'var(--sepia)' }}
                >
                  {isCollapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" aria-hidden="true" />
              )}
              <button
                onClick={() => onPick(n.slug)}
                className="flex min-w-0 flex-1 items-baseline justify-between py-1 rr-link"
                style={{ color: active === n.slug ? 'var(--accent)' : 'var(--ink-soft)', fontSize: '0.92rem' }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0" style={{ width: 7, height: 7, borderRadius: 9, background: n.color, display: 'inline-block' }} />
                  <span className="truncate">{n.name}</span>
                </span>
                <span className="rr-mono shrink-0" style={{ fontSize: '0.62rem' }}>{n.count || ''}</span>
              </button>
            </div>
            {hasChildren && !isCollapsed && (
              <TagTree
                nodes={n.children}
                active={active}
                onPick={onPick}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                selected={selected}
                onToggleSelected={onToggleSelected}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function QuickTile({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled = false,
  disabledAriaLabel,
  disabledTitle,
}: {
  icon: LucideIcon
  label: string
  hint: string
  onClick?: () => void
  disabled?: boolean
  disabledAriaLabel?: string
  disabledTitle?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={disabled ? disabledAriaLabel ?? `${label} capture (planned)` : label}
      title={disabled ? disabledTitle ?? `${label} capture is planned for a later phase.` : undefined}
      className="rr-card text-left px-4 py-3 transition enabled:hover:-translate-y-0.5 enabled:hover:border-blue-200 enabled:hover:shadow-md"
      style={{ borderRadius: 10, opacity: disabled ? 0.62 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-[var(--accent)]">
          <Icon size={16} aria-hidden="true" style={{ strokeWidth: 1.9 }} />
        </span>
        <div className="min-w-0">
          <div className="whitespace-nowrap text-sm font-semibold">{label}</div>
          <div className="mt-1 text-xs text-[var(--sepia)]">{hint}</div>
        </div>
      </div>
    </button>
  )
}

function ProfileMenu({ onKeyDown }: { onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void }) {
  return (
    <div
      id="profile-menu"
      className="absolute right-0 top-full z-30 mt-2 rr-card px-4 py-3 text-left shadow-lg"
      role="menu"
      aria-label="Profile menu"
      onKeyDown={onKeyDown}
      style={{ borderRadius: 4, width: 'min(18rem, calc(100vw - 2rem))' }}
    >
      <div className="mb-3 flex items-start gap-3 rr-rule pb-3">
        <UserCircle size={18} aria-hidden="true" className="mt-1 shrink-0" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <div className="min-w-0">
          <div className="font-display" style={{ fontSize: '1.02rem' }}>Local profile</div>
          <div className="rr-mono mt-1">Reading Room · local desktop build</div>
        </div>
      </div>

      <div className="space-y-3">
        <ProfileMenuSection title="Settings">
          <ProfileMenuLink href="/settings" icon={Settings} label="Settings" hint="Account, data, appearance, quiz, and TTS" />
        </ProfileMenuSection>

        <ProfileMenuSection title="More">
          <ProfileMenuDisabled icon={HelpCircle} label="Docs" hint="Documentation link is planned." />
          <ProfileMenuDisabled icon={FileQuestion} label="FAQ" hint="FAQ link is planned." />
          <ProfileMenuDisabled icon={MessageCircleQuestion} label="Discord" hint="Community link is not configured." />
          <ProfileMenuDisabled icon={Mail} label="Email support" hint="Support mailbox is not configured." />
          <ProfileMenuDisabled icon={Bug} label="Bug report" hint="Feedback intake is planned." />
          <ProfileMenuDisabled icon={Sparkles} label="Feature request" hint="Feature intake is planned." />
          <ProfileMenuDisabled icon={Link2} label="Social links" hint="Social destinations are not configured." />
        </ProfileMenuSection>
      </div>
    </div>
  )
}

function ProfileMenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="rr-mono mb-1" style={{ color: 'var(--gold)' }}>{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function ProfileMenuLink({ href, icon: Icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint: string }) {
  return (
    <Link href={href} role="menuitem" data-profile-menu-item className="flex w-full items-start gap-3 px-1 py-2 rr-link">
      <Icon size={15} aria-hidden="true" className="mt-1 shrink-0" style={{ color: 'var(--accent)', strokeWidth: 1.8 }} />
      <span className="min-w-0">
        <span className="font-display block" style={{ fontSize: '0.98rem' }}>{label}</span>
        <span className="rr-mono mt-0.5 block">{hint}</span>
      </span>
    </Link>
  )
}

function ProfileMenuDisabled({ icon: Icon, label, hint }: { icon: LucideIcon; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled="true"
      disabled
      className="flex w-full items-start gap-3 px-1 py-2 text-left"
      style={{ color: 'var(--sepia)', cursor: 'not-allowed', opacity: 0.58 }}
    >
      <Icon size={15} aria-hidden="true" className="mt-1 shrink-0" style={{ color: 'var(--accent)', strokeWidth: 1.8 }} />
      <span className="min-w-0">
        <span className="font-display block" style={{ fontSize: '0.98rem' }}>{label}</span>
        <span className="rr-mono mt-0.5 block">{hint}</span>
      </span>
    </button>
  )
}

function profileMenuItems(root: HTMLDivElement | null): HTMLElement[] {
  return root
    ? Array.from(root.querySelectorAll<HTMLElement>('[data-profile-menu-item]:not([disabled])'))
    : []
}

function focusFirstProfileMenuItem(root: HTMLDivElement | null) {
  profileMenuItems(root)[0]?.focus()
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ready') return null
  const label = status === 'failed' ? 'extract failed' : status === 'summarizing' ? 'summarizing…' : 'organizing…'
  const color = status === 'failed' ? 'var(--accent)' : 'var(--gold)'
  return <span className="rr-mono" style={{ color }}>{label}</span>
}

function CardGridTile({
  card,
  index,
  selected,
  onToggleSelected,
}: {
  card: CardListItem
  index: number
  selected: boolean
  onToggleSelected: (id: string) => void
}) {
  return (
    <article
      className="rr-card rr-rise relative flex min-h-64 flex-col overflow-hidden"
      style={{
        borderRadius: 3,
        animationDelay: `${Math.min(index, 12) * 45}ms`,
        borderColor: selected ? 'var(--accent)' : undefined,
      }}
    >
      <label className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rr-card" style={{ borderRadius: 3 }}>
        <input
          type="checkbox"
          aria-label={`Select ${card.title}`}
          checked={selected}
          onChange={() => onToggleSelected(card.id)}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
      </label>
      {card.thumbnail ? (
        <Link
          href={`/item/${card.id}`}
          aria-label={`Open ${card.title}`}
          className="relative block w-full overflow-hidden"
          style={{ aspectRatio: '4 / 3' }}
        >
          <Image
            src={card.thumbnail}
            alt=""
            fill
            sizes="(min-width: 1280px) 240px, (min-width: 640px) 50vw, 100vw"
            unoptimized
            loading={index === 0 ? 'eager' : 'lazy'}
            referrerPolicy="no-referrer"
            className="object-cover transition-transform duration-200 hover:scale-[1.02]"
          />
        </Link>
      ) : (
        <Link
          href={`/item/${card.id}`}
          aria-label={`Open ${card.title}`}
          className="flex items-center justify-center rr-rule px-4"
          style={{ aspectRatio: '4 / 3', background: 'var(--paper)' }}
        >
          <span className="rr-mono" style={{ color: 'var(--sepia-2)' }}>{card.sourceType}</span>
        </Link>
      )}
      <div className="flex flex-1 flex-col px-4 py-3">
        <Link href={`/item/${card.id}`} className="rr-link">
          <h3 className="font-display" style={{ fontSize: '1.14rem', fontWeight: 500, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
            {card.title}
          </h3>
        </Link>
        {card.summary
          ? <p className="rr-prose mt-2 line-clamp-3" style={{ fontSize: '0.92rem' }}>{card.summary}</p>
          : <p className="rr-prose mt-2" style={{ fontSize: '0.92rem', opacity: 0.7 }}>{emptySummaryCopy(card)}</p>}
        <div className="mt-auto pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {card.provider && <span className="min-w-0 rr-mono" style={{ overflowWrap: 'anywhere' }}>{card.provider}</span>}
            <span className="rr-mono">updated {relativeTime(card.updatedAt)}</span>
            {card.shared && <span className="rr-tag" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>Shared</span>}
            <StatusBadge status={card.status} />
          </div>
          {card.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.tags.slice(0, 3).map(t => <span key={t.slug} className="rr-tag">{t.name}</span>)}
              {card.tags.length > 3 && <span className="rr-tag">+{card.tags.length - 3}</span>}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function CardRow({
  card,
  index,
  selected,
  onToggleSelected,
}: {
  card: CardListItem
  index: number
  selected: boolean
  onToggleSelected: (id: string) => void
}) {
  return (
    <article
      className="group mb-3 flex gap-3 rounded-xl border bg-white p-3 rr-rise transition hover:border-blue-200 hover:shadow-sm"
      style={{
        animationDelay: `${Math.min(index, 12) * 45}ms`,
        borderColor: selected ? 'var(--accent)' : 'var(--hairline)',
      }}
    >
      <span className="mt-12 hidden h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)] sm:block" aria-hidden="true" />
      <label className="pt-10">
        <input
          type="checkbox"
          aria-label={`Select ${card.title}`}
          checked={selected}
          onChange={() => onToggleSelected(card.id)}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="flex gap-4">
        {card.thumbnail && (
          <Link href={`/item/${card.id}`} aria-label={`Open ${card.title}`} className="relative hidden w-28 shrink-0 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--paper)] sm:block" style={{ aspectRatio: '1 / 1' }}>
            <Image
              src={card.thumbnail}
              alt=""
              fill
              sizes="112px"
              unoptimized
              loading={index === 0 ? 'eager' : 'lazy'}
              referrerPolicy="no-referrer"
              className="object-cover"
            />
          </Link>
        )}
        {!card.thumbnail && (
          <Link
            href={`/item/${card.id}`}
            aria-label={`Open ${card.title}`}
            className="hidden w-28 shrink-0 items-center justify-center rounded-lg border border-[var(--hairline)] bg-[var(--paper)] sm:flex"
            style={{ aspectRatio: '1 / 1' }}
          >
            <span className="rr-mono text-[var(--sepia-2)]">{card.sourceType}</span>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <Link href={`/item/${card.id}`} className="min-w-0">
              <h3 className="min-w-0 text-lg font-semibold leading-snug transition-colors group-hover:text-[var(--accent)]" style={{ overflowWrap: 'anywhere' }}>
              {card.title}
            </h3>
            </Link>
            <span className="hidden shrink-0 text-sm text-[var(--sepia)] sm:block" style={{ whiteSpace: 'nowrap' }}>updated {relativeTime(card.updatedAt)}</span>
          </div>
          {card.summary
            ? <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-[var(--ink-soft)]">{card.summary}</p>
            : <p className="mt-1.5 text-sm leading-6 text-[var(--sepia)]">{emptySummaryCopy(card)}</p>}
          <div className="mt-3 flex min-w-0 items-center gap-2 flex-wrap">
            {card.provider && <span className="min-w-0 text-xs text-[var(--sepia)]" style={{ overflowWrap: 'anywhere' }}>{card.provider}</span>}
            {card.shared && <span className="rr-tag" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>Shared</span>}
            {card.tags.slice(0, 4).map(t => <span key={t.slug} className="rr-tag">{t.name}</span>)}
            <StatusBadge status={card.status} />
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 self-center text-[var(--sepia)] md:flex">
          <button type="button" className="rounded-md p-1.5 hover:bg-[var(--paper)] hover:text-[var(--accent)]" aria-label={`Open comments for ${card.title} (planned)`} disabled title="Card comments are planned.">
            <MessageCircle size={17} aria-hidden="true" />
          </button>
          <button type="button" className="rounded-md p-1.5 hover:bg-[var(--paper)] hover:text-[var(--accent)]" aria-label={`Favorite ${card.title} (planned)`} disabled title="Favorites are planned.">
            <Star size={17} aria-hidden="true" />
          </button>
          <button type="button" className="rounded-md p-1.5 hover:bg-[var(--paper)] hover:text-[var(--accent)]" aria-label={`More actions for ${card.title}`}>
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </div>
        </div>
      </div>
    </article>
  )
}
