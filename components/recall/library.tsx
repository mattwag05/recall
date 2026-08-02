'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { Archive, ArrowDown, ArrowUp, BookOpen, Brain, Bug, Check, CheckSquare, ChevronDown, ChevronRight, Clock, Command, FileQuestion, FileText, FolderPlus, HelpCircle, Image as ImageIcon, Inbox, LayoutGrid, Link2, List, Mail, MessageCircle, MessageCircleQuestion, MoreHorizontal, Network, Pencil, Plus, Search, Settings, SlidersHorizontal, Sparkles, Tag, Table as TableIcon, Tags, Trash2, UserCircle, X, type LucideIcon } from 'lucide-react'
import { AddContentModal, type AddContentTab, type SavedContentMeta } from './add-content-modal'
import { SearchModal } from './search-modal'
import { toast } from './toaster'
import {
  EMPTY_LIBRARY_FILTERS,
  cardSources,
  dateFieldFor,
  filterCards,
  groupByDate,
  relativeTime,
  sortCards,
  tagSubtreeSlugs,
  type CardListItem,
  type LibraryDirection,
  type LibraryFilters,
  type LibraryGroup,
  type LibraryOrder,
  type LibraryView,
  type TagNode,
} from '@/lib/recall-types'
import { errorMessage, readApiError } from '@/lib/api-client'
import { isShortcutTarget } from '@/lib/shortcuts'
import { useDialogFocus } from '@/lib/use-dialog-focus'

/** Which slice of the library is loaded from the server. */
type LibraryScope = { tag: string | null; untagged: boolean }
type TriageView = 'default' | 'archived'

const ALL_SCOPE: LibraryScope = { tag: null, untagged: false }

async function fetchCards(scope: LibraryScope, triage: TriageView = 'default') {
  const params = new URLSearchParams()
  if (scope.tag) params.set('tag', scope.tag)
  if (scope.untagged) params.set('untagged', '1')
  if (triage === 'archived') params.set('triage', 'archived')
  const qs = params.toString()
  const res = await fetch(`/api/cards${qs ? `?${qs}` : ''}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load cards')
  if (!Array.isArray(data.cards)) {
    throw new Error('The local card API returned an unexpected response. Try again instead of trusting an empty library.')
  }
  return {
    cards: data.cards as CardListItem[],
    reviewDue: typeof data.reviewDue === 'number' ? data.reviewDue : 0,
  }
}

async function fetchTags() {
  const res = await fetch('/api/tags')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load tags')
  if (!Array.isArray(data.tags)) {
    throw new Error('The local tag API returned an unexpected response.')
  }
  return { tags: data.tags as TagNode[], untagged: typeof data.untagged === 'number' ? data.untagged : 0 }
}

const LIBRARY_VIEWS: { id: LibraryView; label: string; icon: LucideIcon }[] = [
  { id: 'grid', label: 'Grid', icon: LayoutGrid },
  { id: 'list', label: 'List', icon: List },
  { id: 'table', label: 'Table', icon: TableIcon },
]

const ORDER_OPTIONS: { id: LibraryOrder; label: string }[] = [
  { id: 'updated', label: 'Last updated' },
  { id: 'created', label: 'Created at' },
  { id: 'inbound', label: 'Inbound connections' },
  { id: 'alpha', label: 'Alphabetical' },
]

const DIRECTION_OPTIONS: { id: LibraryDirection; label: string; icon: LucideIcon }[] = [
  { id: 'asc', label: 'Ascending', icon: ArrowUp },
  { id: 'desc', label: 'Descending', icon: ArrowDown },
]

const GROUP_OPTIONS: { id: LibraryGroup; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'none', label: 'None' },
]

const DATE_FILTERS: { id: LibraryFilters['date']; label: string }[] = [
  { id: 'all', label: 'Any date' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
]

const SHARED_FILTERS: { id: LibraryFilters['shared']; label: string }[] = [
  { id: 'all', label: 'Shared: any' },
  { id: 'shared', label: 'Shared only' },
  { id: 'private', label: 'Not shared' },
]

export function Library() {
  const pathname = usePathname()
  const router = useRouter()

  const [cards, setCards] = useState<CardListItem[]>([])
  const [tags, setTags] = useState<TagNode[]>([])
  const [untaggedCount, setUntaggedCount] = useState(0)
  const [scope, setScope] = useState<LibraryScope>(ALL_SCOPE)
  const [addOpen, setAddOpen] = useState(false)
  const [addInitialTab, setAddInitialTab] = useState<AddContentTab>('url')
  const [searchOpen, setSearchOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [tagSort, setTagSort] = useState<'name' | 'count'>('name')
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set())
  const [order, setOrder] = useState<LibraryOrder>('updated')
  const [direction, setDirection] = useState<LibraryDirection>('desc')
  const [group, setGroup] = useState<LibraryGroup>('day')
  const [viewMode, setViewMode] = useState<LibraryView>('list')
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tagSidebarOpen, setTagSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const [inboxCount, setInboxCount] = useState(0)
  const [reviewDue, setReviewDue] = useState(0)
  const [triageView, setTriageView] = useState<TriageView>('default')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const profileButtonRef = useRef<HTMLButtonElement | null>(null)

  const loadCards = useCallback(async (next: LibraryScope, triage: TriageView = 'default') => {
    try {
      const payload = await fetchCards(next, triage)
      setCards(payload.cards)
      setReviewDue(payload.reviewDue)
      setLibraryError(null)
    } catch (err) {
      setLibraryError(errorMessage(err, 'Could not load the library. Check that Recall is still running, then try again.'))
    } finally {
      setLoaded(true)
    }
  }, [])

  const loadTags = useCallback(async () => {
    try {
      const payload = await fetchTags()
      setTags(payload.tags)
      setUntaggedCount(payload.untagged)
      setTagError(null)
    } catch (err) {
      setTagError(errorMessage(err, 'Could not load tag filters. Existing cards are still available; retry tags when the local app is ready.'))
    }
  }, [])

  useEffect(() => {
    loadCards(scope, triageView)
    setSelected(new Set())
  }, [scope, triageView, loadCards])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  // Inbox badge: on mount, every 60s, and whenever the inbox triages a card.
  useEffect(() => {
    const refresh = () => {
      fetch('/api/inbox?count=1')
        .then(res => res.json())
        .then(data => { if (typeof data.total === 'number') setInboxCount(data.total) })
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('inbox-updated', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('inbox-updated', refresh)
    }
  }, [])

  // Poll while any card is still processing (organizing/summarizing).
  useEffect(() => {
    const processing = cards.some(c => c.status === 'organizing' || c.status === 'summarizing')
    if (processing && !pollRef.current) {
      pollRef.current = setInterval(() => { loadCards(scope, triageView); loadTags() }, 4000)
    } else if (!processing && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [cards, scope, triageView, loadCards, loadTags])

  // Keyboard: "/" search, "n" new, ⌘/Ctrl+J chat — single keys are suppressed
  // while a modal or menu is open, and never steal a keystroke from an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        router.push('/chat')
        return
      }
      if (isShortcutTarget(e.target)) return
      if (addOpen || searchOpen || profileOpen || drawerOpen) return
      if (e.key === '/') { e.preventDefault(); setSearchOpen(true) }
      if (e.key === 'n') { e.preventDefault(); setAddInitialTab('url'); setAddOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, searchOpen, profileOpen, drawerOpen, router])

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

  const flatTags = useMemo(() => flattenTags(tags), [tags])
  const sortedTagTree = useMemo(() => sortTagTree(tags, tagSort), [tags, tagSort])
  const visibleTags = useMemo(() => filterTagTree(sortedTagTree, tagQuery), [sortedTagTree, tagQuery])
  const expandableTagIds = useMemo(() => collectExpandableTagIds(tags), [tags])
  const sources = useMemo(() => cardSources(cards), [cards])

  const visibleCards = useMemo(() => {
    const tagFilters = tagSubtreeSlugs(tags, filters.tags)
    return sortCards(filterCards(cards, { ...filters, tags: tagFilters }, order), order, direction)
  }, [cards, tags, filters, order, direction])

  const groups = useMemo(
    () => groupByDate(visibleCards, dateFieldFor(order), group),
    [visibleCards, order, group]
  )

  const activeTagLabel = scope.untagged
    ? 'Untagged cards'
    : scope.tag
      ? flatTags.find(t => t.slug === scope.tag)?.label ?? scope.tag
      : 'All cards'
  const readyCount = cards.filter(card => card.status === 'ready').length
  const processingCount = cards.filter(card => card.status === 'organizing' || card.status === 'summarizing').length
  const failedCount = cards.filter(card => card.status === 'failed').length
  const topTags = flatTags.filter(tag => tag.count > 0).sort((a, b) => b.count - a.count).slice(0, 7)
  const recentCards = visibleCards.slice(0, 4)
  const filtersActive = filters.date !== 'all' || filters.source !== null || filters.shared !== 'all' || filters.tags.length > 0

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

  function toggleFilterTag(slug: string) {
    setFilters(prev => ({
      ...prev,
      tags: prev.tags.includes(slug) ? prev.tags.filter(s => s !== slug) : [...prev.tags, slug],
    }))
  }

  function pickOrder(next: LibraryOrder) {
    setOrder(next)
    // A-Z is what "Alphabetical" means to everyone; dates and counts default to
    // biggest-first. The direction section still overrides this afterwards.
    setDirection(next === 'alpha' ? 'asc' : 'desc')
  }

  function pickScope(next: LibraryScope) {
    setScope(next)
    setDrawerOpen(false)
  }

  function toggleCardSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function createTag(name: string, parentId: string | null) {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    })
    if (!res.ok) {
      toast(await readApiError(res, 'Could not create tag'))
      return
    }
    toast(parentId ? `Added child tag "${name}"` : `Created tag "${name}"`)
    loadTags()
  }

  async function renameTag(id: string, name: string, previousSlug: string) {
    const res = await fetch(`/api/tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      toast(await readApiError(res, 'Could not rename tag'))
      return
    }
    const data = await res.json().catch(() => ({}))
    const nextSlug: string | null = typeof data?.tag?.slug === 'string' ? data.tag.slug : null
    toast(`Renamed to "${name}"`)
    // The slug is derived from the name, so a rename moves the tag's address.
    setFilters(prev => ({
      ...prev,
      tags: nextSlug ? prev.tags.map(slug => (slug === previousSlug ? nextSlug : slug)) : prev.tags,
    }))
    if (scope.tag === previousSlug && nextSlug) setScope({ tag: nextSlug, untagged: false })
    else loadCards(scope, triageView)
    loadTags()
  }

  async function deleteTag(id: string, node: { name: string; slug: string }) {
    const ok = confirm(`Delete the tag "${node.name}"?\n\nCards keep existing (they just lose this tag) and any child tags move up one level.`)
    if (!ok) return
    const res = await fetch(`/api/tags/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast(await readApiError(res, 'Could not delete tag'))
      return
    }
    const data = await res.json().catch(() => ({}))
    const untaggedCards = typeof data.cardsUntagged === 'number' ? data.cardsUntagged : 0
    const promoted = typeof data.childrenPromoted === 'number' ? data.childrenPromoted : 0
    toast(`Deleted "${node.name}" — ${untaggedCards} card${untaggedCards === 1 ? '' : 's'} untagged${promoted ? `, ${promoted} child tag${promoted === 1 ? '' : 's'} promoted` : ''}`)
    setFilters(prev => ({ ...prev, tags: prev.tags.filter(slug => slug !== node.slug) }))
    if (scope.tag === node.slug) setScope(ALL_SCOPE)
    else loadCards(scope, triageView)
    loadTags()
  }

  async function bulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} card${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    const res = await fetch('/api/cards/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action: 'delete' }),
    })
    if (!res.ok) {
      toast(await readApiError(res, 'Could not delete the selected cards'))
      return
    }
    toast(`Deleted ${ids.length} card${ids.length === 1 ? '' : 's'}`)
    setSelected(new Set())
    loadCards(scope, triageView)
    loadTags()
  }

  async function bulkTag(name: string) {
    const ids = [...selected]
    if (ids.length === 0) return
    const res = await fetch('/api/cards/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action: 'tag', tag: name }),
    })
    if (!res.ok) {
      toast(await readApiError(res, 'Could not tag the selected cards'))
      return
    }
    toast(`Tagged ${ids.length} card${ids.length === 1 ? '' : 's'} with "${name}"`)
    setSelected(new Set())
    loadCards(scope, triageView)
    loadTags()
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

  const renderTagPanel = (panelId?: string) => (
    <TagPanel
      panelId={panelId}
      cardCount={cards.length}
      untaggedCount={untaggedCount}
      scope={scope}
      onPickScope={pickScope}
      triageView={triageView}
      onSetTriageView={setTriageView}
      tagQuery={tagQuery}
      setTagQuery={setTagQuery}
      tagSort={tagSort}
      setTagSort={setTagSort}
      visibleTags={visibleTags}
      collapsedTags={tagQuery ? new Set() : collapsedTags}
      onToggleTagBranch={toggleTagBranch}
      filterTags={filters.tags}
      onToggleFilterTag={toggleFilterTag}
      expandableTagCount={expandableTagIds.length}
      expandAllTags={() => setCollapsedTags(new Set())}
      collapseAllTags={() => setCollapsedTags(new Set(expandableTagIds))}
      onCreateTag={createTag}
      onRenameTag={renameTag}
      onDeleteTag={deleteTag}
    />
  )

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <div className="grid min-h-screen lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <ShellNav
          pathname={pathname}
          cardCount={cards.length}
          inboxCount={inboxCount}
          reviewDue={reviewDue}
          tagsVisible={tagSidebarOpen}
          onToggleTags={() => setTagSidebarOpen(open => !open)}
        >
          {tagSidebarOpen && renderTagPanel('tag-sidebar')}
        </ShellNav>

        <div className="min-w-0 border-x border-[var(--hairline)] bg-[var(--card)]/85 backdrop-blur-sm">
          <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-[var(--hairline)] bg-[var(--card)]/90 px-4 backdrop-blur md:px-6">
            <button
              type="button"
              className="rr-btn rr-btn-icon shrink-0 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open collections"
            >
              <Tags size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--paper)] px-3 py-2 text-left text-sm text-[var(--sepia)] transition hover:border-[var(--btn-hover-edge)] hover:bg-[var(--btn-hover-bg)]"
              onClick={() => setSearchOpen(true)}
              aria-label="Search your library or ask Recall"
            >
              <Search size={16} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Search your library, ask anything, or run a command...</span>
              <kbd className="hidden rounded-md border border-[var(--hairline)] bg-[var(--card)] px-1.5 py-0.5 font-mono text-[0.68rem] text-[var(--sepia)] sm:block">/</kbd>
            </button>
            <button className="rr-btn rr-btn-accent rr-btn-icon hidden shrink-0 sm:inline-flex" onClick={() => openAdd('url')}>
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

          <div className="rr-safe-bottom mx-auto max-w-5xl px-4 py-8 md:px-8">
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h1 className="text-2xl font-semibold leading-tight md:text-3xl">Library</h1>
                <p className="mt-2 text-sm text-[var(--sepia)]">
                  {filtersActive
                    ? `${visibleCards.length.toLocaleString()} of ${cards.length.toLocaleString()} items`
                    : `${cards.length.toLocaleString()} items`}
                  {' · '}{activeTagLabel}
                  {' · '}{processingCount > 0 ? `${processingCount} processing` : 'Local sync active'}
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
                <SortViewMenu
                  order={order}
                  onPickOrder={pickOrder}
                  direction={direction}
                  onPickDirection={setDirection}
                  group={group}
                  onPickGroup={setGroup}
                  view={viewMode}
                  onPickView={setViewMode}
                />
              </div>
            </div>

            <FilterBar
              filters={filters}
              setFilters={setFilters}
              sources={sources}
              flatTags={flatTags}
              active={filtersActive}
            />

            {selected.size > 0 && (
              <SelectionBar
                count={selected.size}
                onClear={() => setSelected(new Set())}
                onDelete={bulkDelete}
                onTag={bulkTag}
              />
            )}

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
                    onClick={() => { loadCards(scope, triageView); loadTags() }}
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
                  <button type="button" className="rr-btn shrink-0" onClick={loadTags}>Retry tags</button>
                </div>
              </div>
            )}

            {!loaded && <p className="rr-mono">opening the archive…</p>}

            {loaded && !libraryError && cards.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--card-edge)] bg-[var(--card)] px-6 py-16 text-center">
                <p className="font-display text-xl font-semibold">
                  {scope.untagged ? 'Every card has a tag.' : triageView === 'archived' ? 'Nothing archived yet.' : 'Your library is empty.'}
                </p>
                <p className="rr-prose mt-2">
                  {scope.untagged
                    ? 'Nothing is sitting untagged right now.'
                    : triageView === 'archived'
                      ? 'Cards you archive from the inbox collect here.'
                      : 'Save your first article, transcript, note, or PDF to start building local memory.'}
                </p>
                {!scope.untagged && triageView === 'default' && (
                  <button className="rr-btn rr-btn-accent rr-btn-icon mt-5 mx-auto" onClick={() => openAdd('url')}>
                    <Plus size={15} aria-hidden="true" />
                    <span>Add something</span>
                  </button>
                )}
              </div>
            )}

            {loaded && !libraryError && cards.length > 0 && visibleCards.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--card-edge)] bg-[var(--card)] px-6 py-14 text-center">
                <p className="font-display text-lg font-semibold">No cards match these filters.</p>
                <p className="rr-prose mt-2">{cards.length.toLocaleString()} cards are loaded; the filter bar is hiding all of them.</p>
                <button className="rr-btn mt-5 mx-auto" onClick={() => setFilters(EMPTY_LIBRARY_FILTERS)}>Clear filters</button>
              </div>
            )}

            {groups.map((group_, gi) => (
              <section key={group_.label || 'all'} className="mb-9">
                {group_.label && (
                  <div className="mb-3 flex items-center justify-between">
                    <div className="rr-mono" style={{ color: 'var(--sepia)' }}>{group_.label}</div>
                    <div className="rr-mono">{group_.cards.length} items</div>
                  </div>
                )}
                {viewMode === 'grid' && (
                  <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                    {group_.cards.map((c, i) => (
                      <CardGridTile
                        key={c.id}
                        card={c}
                        index={gi * 6 + i}
                        selected={selected.has(c.id)}
                        onToggleSelected={() => toggleCardSelected(c.id)}
                      />
                    ))}
                  </div>
                )}
                {viewMode === 'list' && (
                  <div>
                    {group_.cards.map((c, i) => (
                      <CardRow
                        key={c.id}
                        card={c}
                        index={gi * 6 + i}
                        selected={selected.has(c.id)}
                        onToggleSelected={() => toggleCardSelected(c.id)}
                      />
                    ))}
                  </div>
                )}
                {viewMode === 'table' && (
                  <CardTable
                    cards={group_.cards}
                    selected={selected}
                    onToggleSelected={toggleCardSelected}
                    order={order}
                    direction={direction}
                    onSort={next => {
                      if (next === order) setDirection(d => (d === 'asc' ? 'desc' : 'asc'))
                      else pickOrder(next)
                    }}
                  />
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
          reviewDue={reviewDue}
        />
      </div>

      <MobileNav
        pathname={pathname}
        inboxCount={inboxCount}
        reviewDue={reviewDue}
        onAdd={() => openAdd('url')}
      />

      <TagDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>{renderTagPanel()}</TagDrawer>

      <AddContentModal
        key={`${addOpen ? 'open' : 'closed'}-${addInitialTab}`}
        open={addOpen}
        initialTab={addInitialTab}
        onClose={() => setAddOpen(false)}
        onSaved={(_id, meta) => { setAddOpen(false); toast(savedMessage(meta)); loadCards(scope, triageView); loadTags() }}
      />
      <SearchModal
        key={`${searchOpen ? 'open' : 'closed'}-${scope.tag ?? 'all'}`}
        open={searchOpen}
        activeTag={scope.tag}
        activeTagLabel={activeTagLabel}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  )
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

function sortTagTree(nodes: TagNode[], mode: 'name' | 'count'): TagNode[] {
  const sorted = [...nodes].sort((a, b) => (mode === 'count' ? b.count - a.count : a.name.localeCompare(b.name)))
  return sorted.map(node => ({ ...node, children: sortTagTree(node.children, mode) }))
}

function collectExpandableTagIds(nodes: TagNode[]): string[] {
  return nodes.flatMap(node => [
    ...(node.children.length > 0 ? [node.id] : []),
    ...collectExpandableTagIds(node.children),
  ])
}

function emptySummaryCopy(card: CardListItem): string {
  if (card.status === 'failed') return 'Could not extract readable content.'
  if (card.status === 'ready') {
    return card.sourceType === 'pasted' ? 'Title-only note.' : 'No summary saved yet.'
  }
  return 'Awaiting summary...'
}

const NAV_ITEMS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: 'Library', href: '/items', icon: BookOpen },
  { label: 'Inbox', href: '/inbox', icon: Inbox },
  { label: 'Chat', href: '/chat', icon: MessageCircle },
  { label: 'Review', href: '/spaced-repetition', icon: Brain },
  { label: 'Graph', href: '/graph', icon: Network },
  { label: 'Settings', href: '/settings', icon: Settings },
]

/** "/" and "/items" are both the library. */
function isNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (href === '/items') return pathname === '/items' || pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function badgeText(count: number): string {
  return count > 99 ? '99+' : count > 0 ? String(count) : ''
}

function ShellNav({
  pathname,
  cardCount,
  inboxCount,
  reviewDue,
  tagsVisible,
  onToggleTags,
  children,
}: {
  pathname: string | null
  cardCount: number
  inboxCount: number
  reviewDue: number
  tagsVisible: boolean
  onToggleTags: () => void
  children: React.ReactNode
}) {
  const meta: Record<string, string> = {
    Library: cardCount.toLocaleString(),
    Inbox: badgeText(inboxCount),
    Chat: '⌘ J',
    Review: badgeText(reviewDue),
    Settings: '',
  }

  return (
    <aside className="hidden min-h-screen border-r border-[var(--hairline)] bg-[var(--paper-2)]/80 px-3 py-4 backdrop-blur lg:flex lg:flex-col">
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
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          const active = isNavActive(pathname, item.href)
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--ink-soft)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'}`}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="font-mono text-xs text-[var(--sepia)]">{meta[item.label]}</span>
            </Link>
          )
        })}
      </nav>

      {children}

      <div className="mt-5 border-t border-[var(--hairline)] pt-4">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)] shadow-[0_0_0_4px_rgba(34,197,94,0.12)]" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Local sync active</span>
            <span className="block text-xs text-[var(--sepia)]">All data stays on this device</span>
          </span>
        </div>
      </div>
    </aside>
  )
}

function MobileNav({
  pathname,
  inboxCount,
  reviewDue,
  onAdd,
}: {
  pathname: string | null
  inboxCount: number
  reviewDue: number
  onAdd: () => void
}) {
  const counts: Record<string, number> = { Inbox: inboxCount, Review: reviewDue }
  return (
    <div className="rr-bottom-dock lg:hidden">
      <nav className="rr-nav-pill" aria-label="Primary">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          const active = isNavActive(pathname, item.href)
          const count = counts[item.label] ?? 0
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={count > 0 ? `${item.label} (${count})` : item.label}
              className="rr-nav-pill-item"
              data-active={active ? 'true' : undefined}
            >
              <span className="relative">
                <Icon size={19} aria-hidden="true" />
                {count > 0 && <span className="rr-nav-dot" aria-hidden="true" />}
              </span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      <button type="button" className="rr-fab" onClick={onAdd} aria-label="Add content">
        <Plus size={22} aria-hidden="true" />
      </button>
    </div>
  )
}

function TagDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  useDialogFocus(open, panelRef)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Close collections" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Collections"
        className="rr-drawer absolute inset-y-0 left-0 flex w-[19rem] max-w-[86vw] flex-col overflow-y-auto border-r border-[var(--hairline)] bg-[var(--paper-2)] px-3 py-4"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-lg font-semibold">Recall</span>
          <button type="button" className="rr-btn rr-btn-icon" onClick={onClose}>
            <X size={14} aria-hidden="true" />
            <span>Close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Shared popover shell: click-outside and Escape close it, Tab is trapped while
 * open, and focus returns to the trigger on close (useDialogFocus).
 */
function Popover({
  label,
  ariaLabel,
  icon: Icon,
  badge,
  variant = 'chip',
  width = '17rem',
  align = 'left',
  children,
}: {
  label: string
  ariaLabel: string
  icon?: LucideIcon
  badge?: string
  variant?: 'chip' | 'ghost'
  width?: string
  align?: 'left' | 'right'
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  useDialogFocus(open, panelRef)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      {variant === 'ghost' ? (
        <button
          type="button"
          className="rr-icon-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen(o => !o)}
        >
          {Icon && <Icon size={14} aria-hidden="true" />}
        </button>
      ) : (
        <button
          type="button"
          className="rr-btn rr-btn-icon"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          style={badge ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
        >
          {Icon && <Icon size={14} aria-hidden="true" />}
          <span>{label}</span>
          {badge && <span className="rr-count">{badge}</span>}
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      )}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel}
          className={`rr-pop ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** Radio list with roving tabindex, as used by the sort/view menu sections. */
function MenuRadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: T; label: string; icon?: LucideIcon }[]
  value: T
  onChange: (id: T) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (current - 1 + items.length) % items.length
      : (current + 1) % items.length
    items[next].focus()
    items[next].click()
  }

  return (
    <div className="rr-pop-section">
      <div className="rr-mono mb-1.5">{label}</div>
      <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {options.map(option => {
          const Icon = option.icon
          const selected = option.id === value
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className="rr-pop-item"
              onClick={() => onChange(option.id)}
              style={selected ? { color: 'var(--accent)' } : undefined}
            >
              {Icon && <Icon size={14} aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
              {selected && <Check size={14} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SortViewMenu({
  order,
  onPickOrder,
  direction,
  onPickDirection,
  group,
  onPickGroup,
  view,
  onPickView,
}: {
  order: LibraryOrder
  onPickOrder: (id: LibraryOrder) => void
  direction: LibraryDirection
  onPickDirection: (id: LibraryDirection) => void
  group: LibraryGroup
  onPickGroup: (id: LibraryGroup) => void
  view: LibraryView
  onPickView: (id: LibraryView) => void
}) {
  const viewLabel = LIBRARY_VIEWS.find(v => v.id === view)?.label ?? 'Grid'
  return (
    <Popover
      label={`Sort & view: ${viewLabel}`}
      ariaLabel="Sort and view options"
      icon={SlidersHorizontal}
      align="right"
      width="16rem"
    >
      {() => (
        <>
          <MenuRadioGroup label="Order by" options={ORDER_OPTIONS} value={order} onChange={onPickOrder} />
          <MenuRadioGroup label="Direction" options={DIRECTION_OPTIONS} value={direction} onChange={onPickDirection} />
          <MenuRadioGroup label="Group by" options={GROUP_OPTIONS} value={group} onChange={onPickGroup} />
          <MenuRadioGroup label="View" options={LIBRARY_VIEWS} value={view} onChange={onPickView} />
        </>
      )}
    </Popover>
  )
}

function FilterBar({
  filters,
  setFilters,
  sources,
  flatTags,
  active,
}: {
  filters: LibraryFilters
  setFilters: (next: LibraryFilters | ((prev: LibraryFilters) => LibraryFilters)) => void
  sources: string[]
  flatTags: { slug: string; label: string; color: string; count: number }[]
  active: boolean
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by date"
        className="rr-select"
        value={filters.date}
        onChange={e => setFilters(prev => ({ ...prev, date: e.target.value as LibraryFilters['date'] }))}
        style={filters.date !== 'all' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
      >
        {DATE_FILTERS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>

      <select
        aria-label="Filter by source"
        className="rr-select"
        value={filters.source ?? ''}
        onChange={e => setFilters(prev => ({ ...prev, source: e.target.value || null }))}
        style={filters.source ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
      >
        <option value="">Any source</option>
        {sources.map(source => <option key={source} value={source}>{source}</option>)}
      </select>

      <Popover
        label="Tags"
        ariaLabel="Filter by tags"
        icon={Tag}
        badge={filters.tags.length ? String(filters.tags.length) : undefined}
        width="18rem"
      >
        {() => (
          <div className="rr-pop-section">
            {flatTags.length === 0 ? (
              <p className="rr-mono py-1">No tags yet.</p>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto">
                  {flatTags.map(tag => (
                    <label key={tag.slug} className="rr-pop-item cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                        checked={filters.tags.includes(tag.slug)}
                        onChange={() => setFilters(prev => ({
                          ...prev,
                          tags: prev.tags.includes(tag.slug) ? prev.tags.filter(s => s !== tag.slug) : [...prev.tags, tag.slug],
                        }))}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{tag.label}</span>
                      <span className="rr-mono shrink-0">{tag.count || ''}</span>
                    </label>
                  ))}
                </div>
                {filters.tags.length > 0 && (
                  <button
                    type="button"
                    className="rr-btn mt-2 w-full"
                    onClick={() => setFilters(prev => ({ ...prev, tags: [] }))}
                  >
                    Clear tag filter
                  </button>
                )}
                <p className="rr-mono mt-2">Matches cards carrying any selected tag, including its child tags.</p>
              </>
            )}
          </div>
        )}
      </Popover>

      <select
        aria-label="Filter by shared state"
        className="rr-select"
        value={filters.shared}
        onChange={e => setFilters(prev => ({ ...prev, shared: e.target.value as LibraryFilters['shared'] }))}
        style={filters.shared !== 'all' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
      >
        {SHARED_FILTERS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>

      {active && (
        <button type="button" className="rr-btn rr-btn-icon" onClick={() => setFilters(EMPTY_LIBRARY_FILTERS)}>
          <X size={13} aria-hidden="true" />
          <span>Clear filters</span>
        </button>
      )}
    </div>
  )
}

function SelectionBar({
  count,
  onClear,
  onDelete,
  onTag,
}: {
  count: number
  onClear: () => void
  onDelete: () => void
  onTag: (name: string) => void
}) {
  const [tagName, setTagName] = useState('')

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-3 py-2.5">
      <span className="text-sm font-medium text-[var(--accent)]">{count} selected</span>
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={e => {
          e.preventDefault()
          const name = tagName.trim()
          if (!name) return
          onTag(name)
          setTagName('')
        }}
      >
        <input
          className="rr-input min-w-0 flex-1"
          style={{ maxWidth: '16rem' }}
          placeholder="Add a tag to all selected"
          aria-label="Tag to add to the selected cards"
          value={tagName}
          onChange={e => setTagName(e.target.value)}
        />
        <button type="submit" className="rr-btn rr-btn-icon" disabled={!tagName.trim()}>
          <Tag size={13} aria-hidden="true" />
          <span>Add tag</span>
        </button>
      </form>
      <button type="button" className="rr-btn rr-btn-icon" onClick={onDelete} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
        <Trash2 size={13} aria-hidden="true" />
        <span>Delete selected</span>
      </button>
      <button type="button" className="rr-btn" onClick={onClear}>Clear selection</button>
    </div>
  )
}

function InsightRail({
  cards,
  recentCards,
  topTags,
  readyCount,
  processingCount,
  failedCount,
  reviewDue,
}: {
  cards: CardListItem[]
  recentCards: CardListItem[]
  topTags: { slug: string; label: string; color: string; count: number }[]
  readyCount: number
  processingCount: number
  failedCount: number
  reviewDue: number
}) {
  return (
    <aside className="hidden min-h-screen bg-[var(--paper)] px-4 py-6 xl:block">
      <div className="sticky top-6 space-y-4">
        <RailPanel title="Today">
          <MetricRow icon={Plus} label="Items saved" value={cards.length} />
          <MetricRow icon={CheckSquare} label="Ready cards" value={readyCount} />
          <MetricRow icon={Clock} label="Processing" value={processingCount} />
          <MetricRow icon={Bug} label="Needs attention" value={failedCount} />
        </RailPanel>

        <RailPanel title="Related ideas">
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

        <RailPanel title="Review due">
          <MetricRow icon={Brain} label="Questions due now" value={reviewDue} />
          <p className="mt-1 text-sm text-[var(--sepia)]">
            {reviewDue > 0 ? 'Scheduled by the spaced-repetition planner.' : 'Nothing is due right now.'}
          </p>
          <Link href="/spaced-repetition" className="rr-btn mt-3 w-full justify-between">
            <span>{reviewDue > 0 ? 'Start review' : 'Open review'}</span>
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </RailPanel>

        {recentCards.length > 0 && (
          <RailPanel title="Recent">
            <div className="space-y-2">
              {recentCards.map(card => (
                <Link key={card.id} href={`/item/${card.id}`} className="block rounded-lg px-2 py-1.5 hover:bg-[var(--paper)]">
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

function RailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--hairline)] bg-[var(--card)] p-4 shadow-sm">
      <h2 className="rr-mono mb-3 text-[var(--ink)]">{title}</h2>
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

type TagDraft = { parentId: string | null } | null

function TagPanel({
  panelId,
  cardCount,
  untaggedCount,
  scope,
  onPickScope,
  triageView,
  onSetTriageView,
  tagQuery,
  setTagQuery,
  tagSort,
  setTagSort,
  visibleTags,
  collapsedTags,
  onToggleTagBranch,
  filterTags,
  onToggleFilterTag,
  expandableTagCount,
  expandAllTags,
  collapseAllTags,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
}: {
  panelId?: string
  cardCount: number
  untaggedCount: number
  scope: LibraryScope
  onPickScope: (scope: LibraryScope) => void
  triageView: TriageView
  onSetTriageView: (view: TriageView) => void
  tagQuery: string
  setTagQuery: (value: string) => void
  tagSort: 'name' | 'count'
  setTagSort: (value: 'name' | 'count') => void
  visibleTags: TagNode[]
  collapsedTags: Set<string>
  onToggleTagBranch: (id: string) => void
  filterTags: string[]
  onToggleFilterTag: (slug: string) => void
  expandableTagCount: number
  expandAllTags: () => void
  collapseAllTags: () => void
  onCreateTag: (name: string, parentId: string | null) => void | Promise<void>
  onRenameTag: (id: string, name: string, previousSlug: string) => void | Promise<void>
  onDeleteTag: (id: string, node: { name: string; slug: string }) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<TagDraft>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  return (
    <section id={panelId} className="mt-6 min-h-0 flex-1 overflow-y-auto border-t border-[var(--hairline)] pt-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="rr-mono">Collections</div>
        <button
          type="button"
          className="rr-icon-btn"
          onClick={() => setDraft({ parentId: null })}
          aria-label="Add new tag"
          title="Add a top-level tag"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      {draft && draft.parentId === null && (
        <TagNameForm
          placeholder="New tag name"
          onSubmit={name => { setDraft(null); onCreateTag(name, null) }}
          onCancel={() => setDraft(null)}
        />
      )}

      <button
        onClick={() => { onPickScope(ALL_SCOPE); onSetTriageView('default') }}
        className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium ${scope.tag === null && !scope.untagged && triageView === 'default' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--ink-soft)] hover:bg-[var(--paper)]'}`}
      >
        <span className="flex items-center gap-2"><Inbox size={15} aria-hidden="true" /> All items</span>
        <span className="font-mono text-xs text-[var(--sepia)]">{cardCount}</span>
      </button>
      <button
        onClick={() => onSetTriageView(triageView === 'archived' ? 'default' : 'archived')}
        aria-pressed={triageView === 'archived'}
        className={`mb-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${triageView === 'archived' ? 'bg-[var(--accent)]/15 font-medium text-[var(--accent)]' : 'text-[var(--ink-soft)] hover:bg-[var(--paper)]'}`}
        title="Archived cards are hidden from the library by default"
      >
        <span className="flex min-w-0 items-center gap-2"><Archive size={15} aria-hidden="true" /> <span className="truncate">Archived</span></span>
      </button>

      <div className="mb-3 flex items-center gap-3 text-xs font-medium text-[var(--sepia)]">
        <button
          type="button"
          onClick={() => setTagSort(tagSort === 'name' ? 'count' : 'name')}
          className="hover:text-[var(--accent)]"
          title="Toggle between name and card count"
        >
          Sort: {tagSort === 'name' ? 'A-Z' : 'most cards'}
        </button>
        {expandableTagCount > 0 && (
          <>
            <button type="button" onClick={expandAllTags} className="hover:text-[var(--accent)]">Expand all</button>
            <button type="button" onClick={collapseAllTags} className="hover:text-[var(--accent)]">Collapse</button>
          </>
        )}
      </div>

      <label className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2">
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
          scope={scope}
          onPick={slug => onPickScope({ tag: slug, untagged: false })}
          depth={0}
          collapsed={collapsedTags}
          onToggle={onToggleTagBranch}
          filterTags={filterTags}
          onToggleFilterTag={onToggleFilterTag}
          draft={draft}
          setDraft={setDraft}
          renaming={renaming}
          setRenaming={setRenaming}
          onCreateTag={onCreateTag}
          onRenameTag={onRenameTag}
          onDeleteTag={onDeleteTag}
        />
      ) : (
        <p className="rr-mono py-2">No tags found</p>
      )}

      <button
        onClick={() => onPickScope({ tag: null, untagged: true })}
        className={`mt-3 flex w-full items-center justify-between rounded-lg border-t border-[var(--hairline)] px-3 pt-3 pb-2 text-left text-sm ${scope.untagged ? 'font-medium text-[var(--accent)]' : 'text-[var(--ink-soft)] hover:bg-[var(--paper)]'}`}
      >
        <span className="flex min-w-0 items-center gap-2"><FileQuestion size={15} aria-hidden="true" /> <span className="truncate">Untagged cards</span></span>
        <span className="font-mono text-xs text-[var(--sepia)]">{untaggedCount || ''}</span>
      </button>
    </section>
  )
}

function TagNameForm({
  initial = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial?: string
  placeholder: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      className="mb-2 flex items-center gap-1.5"
      onSubmit={e => {
        e.preventDefault()
        const name = value.trim()
        if (name) onSubmit(name)
      }}
    >
      <input
        autoFocus
        className="rr-input min-w-0 flex-1"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      />
      <button type="submit" className="rr-icon-btn" aria-label="Save tag" disabled={!value.trim()}>
        <Check size={14} aria-hidden="true" />
      </button>
      <button type="button" className="rr-icon-btn" aria-label="Cancel" onClick={onCancel}>
        <X size={14} aria-hidden="true" />
      </button>
    </form>
  )
}

function TagTree({
  nodes,
  scope,
  onPick,
  depth,
  collapsed,
  onToggle,
  filterTags,
  onToggleFilterTag,
  draft,
  setDraft,
  renaming,
  setRenaming,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
}: {
  nodes: TagNode[]
  scope: LibraryScope
  onPick: (slug: string) => void
  depth: number
  collapsed: Set<string>
  onToggle: (id: string) => void
  filterTags: string[]
  onToggleFilterTag: (slug: string) => void
  draft: TagDraft
  setDraft: (draft: TagDraft) => void
  renaming: { id: string; name: string } | null
  setRenaming: (value: { id: string; name: string } | null) => void
  onCreateTag: (name: string, parentId: string | null) => void | Promise<void>
  onRenameTag: (id: string, name: string, previousSlug: string) => void | Promise<void>
  onDeleteTag: (id: string, node: { name: string; slug: string }) => void | Promise<void>
}) {
  if (!nodes.length) return null
  return (
    <div style={{ paddingLeft: depth ? 12 : 0 }}>
      {nodes.map(n => {
        const hasChildren = n.children.length > 0
        const isCollapsed = collapsed.has(n.id)
        const active = scope.tag === n.slug

        if (renaming?.id === n.id) {
          return (
            <TagNameForm
              key={n.id}
              initial={n.name}
              placeholder="Tag name"
              onSubmit={name => { setRenaming(null); onRenameTag(n.id, name, n.slug) }}
              onCancel={() => setRenaming(null)}
            />
          )
        }

        return (
          <div key={n.id}>
            <div className="flex items-center gap-1">
              <input
                type="checkbox"
                aria-label={`Filter by tag ${n.name}`}
                checked={filterTags.includes(n.slug)}
                onChange={() => onToggleFilterTag(n.slug)}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
              />
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggle(n.id)}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${n.name} tag branch`}
                  aria-expanded={!isCollapsed}
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
                style={{ color: active ? 'var(--accent)' : 'var(--ink-soft)', fontSize: '0.92rem' }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0" style={{ width: 7, height: 7, borderRadius: 9, background: n.color, display: 'inline-block' }} />
                  <span className="truncate">{n.name}</span>
                </span>
                <span className="rr-mono shrink-0" style={{ fontSize: '0.62rem' }}>{n.count || ''}</span>
              </button>
              <Popover label={`Actions for ${n.name}`} ariaLabel={`Actions for ${n.name}`} icon={MoreHorizontal} variant="ghost" align="right" width="13rem">
                {close => (
                  <div className="rr-pop-section">
                    <button
                      type="button"
                      className="rr-pop-item"
                      onClick={() => { close(); setDraft({ parentId: n.id }) }}
                    >
                      <FolderPlus size={14} aria-hidden="true" />
                      <span className="flex-1 text-left">Add child tag</span>
                    </button>
                    <button
                      type="button"
                      className="rr-pop-item"
                      onClick={() => { close(); setRenaming({ id: n.id, name: n.name }) }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      <span className="flex-1 text-left">Edit tag</span>
                    </button>
                    <button
                      type="button"
                      className="rr-pop-item"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => { close(); onDeleteTag(n.id, { name: n.name, slug: n.slug }) }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span className="flex-1 text-left">Delete tag</span>
                    </button>
                  </div>
                )}
              </Popover>
            </div>

            {draft && draft.parentId === n.id && (
              <div style={{ paddingLeft: 12 }}>
                <TagNameForm
                  placeholder={`Child of ${n.name}`}
                  onSubmit={name => { setDraft(null); onCreateTag(name, n.id) }}
                  onCancel={() => setDraft(null)}
                />
              </div>
            )}

            {hasChildren && !isCollapsed && (
              <TagTree
                nodes={n.children}
                scope={scope}
                onPick={onPick}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                filterTags={filterTags}
                onToggleFilterTag={onToggleFilterTag}
                draft={draft}
                setDraft={setDraft}
                renaming={renaming}
                setRenaming={setRenaming}
                onCreateTag={onCreateTag}
                onRenameTag={onRenameTag}
                onDeleteTag={onDeleteTag}
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
}: {
  icon: LucideIcon
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rr-card cursor-pointer text-left px-4 py-3 transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-md"
      style={{ borderRadius: 10 }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)]">
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
      style={{ width: 'min(18rem, calc(100vw - 2rem))' }}
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

function SelectCheckbox({
  card,
  selected,
  onToggle,
  className,
}: {
  card: CardListItem
  selected: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggle}
      aria-label={`Select ${card.title}`}
      className={`h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)] ${className ?? ''}`}
    />
  )
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
  onToggleSelected: () => void
}) {
  return (
    <article
      className="rr-card rr-rise relative flex min-h-64 flex-col overflow-hidden"
      style={{
        borderRadius: 6,
        borderColor: selected ? 'var(--accent)' : undefined,
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      }}
    >
      <span className="absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md border border-[var(--hairline)] bg-[var(--card)]/90">
        <SelectCheckbox card={card} selected={selected} onToggle={onToggleSelected} />
      </span>
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
  onToggleSelected: () => void
}) {
  return (
    <article
      className="group mb-3 flex gap-3 rounded-xl border bg-[var(--card)] p-3 rr-rise transition hover:border-[var(--accent)]/40 hover:shadow-sm"
      style={{
        animationDelay: `${Math.min(index, 12) * 45}ms`,
        borderColor: selected ? 'var(--accent)' : 'var(--hairline)',
      }}
    >
      <SelectCheckbox card={card} selected={selected} onToggle={onToggleSelected} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex gap-4">
          {card.thumbnail ? (
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
          ) : (
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
              {(card.inboundCount ?? 0) > 0 && (
                <span className="rr-mono inline-flex items-center gap-1" title={`${card.inboundCount} inbound connections`}>
                  <Network size={12} aria-hidden="true" />{card.inboundCount}
                </span>
              )}
              <StatusBadge status={card.status} />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function CardTable({
  cards,
  selected,
  onToggleSelected,
  order,
  direction,
  onSort,
}: {
  cards: CardListItem[]
  selected: Set<string>
  onToggleSelected: (id: string) => void
  order: LibraryOrder
  direction: LibraryDirection
  onSort: (order: LibraryOrder) => void
}) {
  function header(label: string, id: LibraryOrder | null) {
    if (!id) return <th key={label} scope="col">{label}</th>
    const activeSort = order === id
    return (
      <th key={label} scope="col" aria-sort={activeSort ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="rr-table-sort" onClick={() => onSort(id)} style={activeSort ? { color: 'var(--accent)' } : undefined}>
          <span>{label}</span>
          {activeSort && (direction === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
        </button>
      </th>
    )
  }

  return (
    <div className="rr-table-wrap">
      <table className="rr-table">
        <thead>
          <tr>
            <th scope="col" className="w-8"><span className="sr-only">Select</span></th>
            {header('Title', 'alpha')}
            {header('Source', null)}
            {header('Tags', null)}
            {header('Updated', 'updated')}
            {header('Inbound', 'inbound')}
          </tr>
        </thead>
        <tbody>
          {cards.map(card => (
            <tr key={card.id} data-selected={selected.has(card.id) ? 'true' : undefined}>
              <td><SelectCheckbox card={card} selected={selected.has(card.id)} onToggle={() => onToggleSelected(card.id)} /></td>
              <td>
                <Link href={`/item/${card.id}`} className="rr-link font-medium">{card.title}</Link>
                <StatusBadge status={card.status} />
              </td>
              <td className="text-[var(--sepia)]">{card.provider || '—'}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  {card.tags.slice(0, 2).map(t => <span key={t.slug} className="rr-tag">{t.name}</span>)}
                  {card.tags.length > 2 && <span className="rr-tag">+{card.tags.length - 2}</span>}
                  {card.tags.length === 0 && <span className="text-[var(--sepia-2)]">—</span>}
                </span>
              </td>
              <td className="whitespace-nowrap text-[var(--sepia)]">{relativeTime(card.updatedAt)}</td>
              <td className="text-right tabular-nums text-[var(--sepia)]">{card.inboundCount ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
