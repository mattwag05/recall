'use client'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'
import type { CardListItem } from '@/lib/recall-types'
import { useDialogFocus } from '@/lib/use-dialog-focus'

const RECENT_SEARCHES_KEY = 'recall:recent-searches:v1'

type SearchSurface = 'notebook' | 'reader' | 'quiz'
type DateFilter = 'any' | 'today' | 'week' | 'month'
type SearchScope = 'current' | 'all'

const SEARCH_SURFACES: { id: SearchSurface; label: string }[] = [
  { id: 'notebook', label: 'Notebook' },
  { id: 'reader', label: 'Reader' },
  { id: 'quiz', label: 'Quiz' },
]
const DEFAULT_SEARCH_IN: SearchSurface[] = ['notebook', 'reader', 'quiz']
const SEARCH_SCOPES: { id: SearchScope; label: string }[] = [
  { id: 'current', label: 'Current tag' },
  { id: 'all', label: 'All cards' },
]
const SEMANTIC_SEARCH_TITLE = 'Semantic search uses local full-card embeddings.'
const SEMANTIC_SURFACE_TITLE = 'Search in filters apply to exact text. Semantic search ranks full-card embeddings.'

type RecentSearch = {
  query: string
  scope: SearchScope
  tag: string | null
  tagLabel: string | null
  surfaces?: SearchSurface[]
  dateFilter?: DateFilter
  at: string
}

export function SearchModal({
  open,
  activeTag,
  activeTagLabel,
  onClose,
}: {
  open: boolean
  activeTag?: string | null
  activeTagLabel?: string
  onClose: () => void
}) {
  const [mode, setMode] = useState<'text' | 'ai'>('text')
  const [scope, setScope] = useState<SearchScope>('current')
  const [searchIn, setSearchIn] = useState<SearchSurface[]>(DEFAULT_SEARCH_IN)
  const [dateFilter, setDateFilter] = useState<DateFilter>('any')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CardListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogFocus(open, dialogRef)
  const semanticMode = mode === 'ai'
  const scopedTag = activeTag && scope === 'current' ? activeTag : null
  const visibleRecentSearches = recentSearches.filter(search => !search.tag || search.tag === activeTag)

  useEffect(() => {
    if (open) {
      setMode('text')
      setScope(activeTag ? 'current' : 'all')
      setSearchIn(DEFAULT_SEARCH_IN)
      setDateFilter('any')
      setRecentSearches(readRecentSearches())
      setTimeout(() => inputRef.current?.focus(), 30)
    } else {
      setQ('')
      setResults([])
      setLoading(false)
      setSearchError(null)
    }
  }, [open, activeTag])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term) { setResults([]); setSearchError(null); return }
    const t = setTimeout(async () => {
      setLoading(true)
      setResults([])
      setSearchError(null)
      try {
        const params = new URLSearchParams({ query: term })
        if (scopedTag) params.set('tag', scopedTag)
        if (semanticMode) {
          params.set('mode', 'semantic')
        } else {
          params.set('surfaces', searchIn.join(','))
        }
        if (dateFilter !== 'any') params.set('date', dateFilter)
        const res = await fetch(`/api/cards?${params}`)
        if (!res.ok) {
          throw new Error(await readApiError(
            res,
            semanticMode
              ? 'Semantic search failed. Check that Ollama is running with nomic-embed-text, then edit the query to try again.'
              : 'Search failed. Check that the local app is still running, then edit the query to try again.',
          ))
        }
        const data = await res.json().catch(() => null)
        const cards = data && typeof data === 'object' ? (data as { cards?: unknown }).cards : null
        if (!Array.isArray(cards)) {
          throw new Error('The local search API returned an unexpected response. Edit the query to try again.')
        }
        setResults(cards as CardListItem[])
        if (!semanticMode) {
          const nextRecent = rememberSearch({
            query: term,
            scope,
            tag: scopedTag,
            tagLabel: scopedTag ? activeTagLabel ?? scopedTag : null,
            surfaces: searchIn,
            dateFilter,
            at: new Date().toISOString(),
          })
          setRecentSearches(nextRecent)
        }
      } catch (err) {
        setResults([])
        setSearchError(errorMessage(
          err,
          semanticMode
            ? 'Semantic search failed. Check that Ollama is running with nomic-embed-text, then edit the query to try again.'
            : 'Search failed. Check that the local app is still running, then edit the query to try again.',
        ))
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [q, open, semanticMode, scopedTag, scope, activeTagLabel, searchIn, dateFilter])

  function clearRecentSearches() {
    try { localStorage.removeItem(RECENT_SEARCHES_KEY) } catch {}
    setRecentSearches([])
  }

  function replaySearch(search: RecentSearch) {
    setMode('text')
    setScope(search.scope)
    setSearchIn(search.surfaces ?? DEFAULT_SEARCH_IN)
    setDateFilter(search.dateFilter ?? 'any')
    setQ(search.query)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  function toggleSearchIn(surface: SearchSurface) {
    setSearchIn(prev => {
      if (prev.includes(surface)) {
        if (prev.length === 1) return prev
        return prev.filter(item => item !== surface)
      }
      return [...prev, surface]
    })
  }

  function focusMode(next: 'text' | 'ai') {
    setMode(next)
    window.setTimeout(() => document.getElementById(searchModeTabId(next))?.focus(), 0)
  }

  function onModeKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: 'text' | 'ai') {
    const modes = ['text', 'ai'] as const
    const currentIndex = modes.indexOf(current)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      focusMode(modes[currentIndex === 0 ? 1 : 0])
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusMode('text')
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusMode('ai')
    }
  }

  function focusScope(next: SearchScope) {
    setScope(next)
    window.setTimeout(() => document.getElementById(searchScopeRadioId(next))?.focus(), 0)
  }

  function onScopeKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: SearchScope) {
    const currentIndex = SEARCH_SCOPES.findIndex(item => item.id === current)
    if (currentIndex < 0) return

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusScope(SEARCH_SCOPES[(currentIndex + 1) % SEARCH_SCOPES.length].id)
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusScope(SEARCH_SCOPES[(currentIndex - 1 + SEARCH_SCOPES.length) % SEARCH_SCOPES.length].id)
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusScope(SEARCH_SCOPES[0].id)
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusScope(SEARCH_SCOPES[SEARCH_SCOPES.length - 1].id)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      style={{ background: 'rgba(26,23,20,0.34)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="rr-card w-full max-w-2xl rr-rise"
        style={{ borderRadius: 4 }}
        role="dialog"
        aria-modal="true"
        aria-label="Search library"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 rr-rule">
          <span className="rr-mono" style={{ color: 'var(--accent)' }}>search</span>
          <input
            ref={inputRef}
            aria-label={mode === 'text' ? 'Search exact text' : 'Search by meaning'}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={mode === 'text' ? 'Exact words & phrases…' : 'Describe what you want to find…'}
            title={semanticMode ? SEMANTIC_SEARCH_TITLE : undefined}
            className="flex-1 bg-transparent outline-none"
            style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem' }}
          />
          <button className="rr-mono" onClick={onClose} aria-label="Close search">esc</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3">
          <div className="flex gap-4" role="tablist" aria-label="Search mode">
            {(['text', 'ai'] as const).map(m => (
              <button
                key={m}
                id={searchModeTabId(m)}
                type="button"
                role="tab"
                aria-selected={mode === m}
                aria-controls={searchModePanelId(m)}
                tabIndex={mode === m ? 0 : -1}
                onClick={() => setMode(m)}
                onKeyDown={e => onModeKeyDown(e, m)}
                className="rr-mono pb-2"
                style={{
                  color: mode === m ? 'var(--accent)' : 'var(--sepia)',
                  borderBottom: mode === m ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {m === 'text' ? 'Text' : 'AI · semantic'}
              </button>
            ))}
          </div>
        </div>

        <div
          id={searchModePanelId(mode)}
          role="tabpanel"
          aria-labelledby={searchModeTabId(mode)}
          className="grid gap-3 px-5 pt-4 sm:grid-cols-[1.2fr_0.8fr_1fr]"
        >
          <fieldset className="rr-card px-3 py-2" style={{ borderRadius: 3 }}>
            <legend className="rr-mono mb-2">Search in</legend>
            <div className="flex flex-wrap gap-2">
              {SEARCH_SURFACES.map(surface => {
                const checked = searchIn.includes(surface.id)
                return (
                  <label
                    key={surface.id}
                    className="rr-tag flex items-center gap-1.5"
                    title={semanticMode ? SEMANTIC_SURFACE_TITLE : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={semanticMode || (checked && searchIn.length === 1)}
                      aria-label={semanticMode
                        ? `${surface.label} exact-text search surface (Text mode only)`
                        : `${surface.label} search surface`}
                      onChange={() => toggleSearchIn(surface.id)}
                      className="h-3 w-3 accent-[var(--accent)]"
                    />
                    {surface.label}
                  </label>
                )
              })}
            </div>
          </fieldset>
          <label className="rr-card block px-3 py-2" style={{ borderRadius: 3 }}>
            <span className="rr-mono">Date</span>
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value as DateFilter)}
              className="rr-select mt-2 w-full"
              aria-label="Date filter"
            >
              <option value="any">Any time</option>
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </select>
          </label>
          <div className="rr-card px-3 py-2" style={{ borderRadius: 3 }}>
            <div className="rr-mono mb-2">Tags</div>
            <div className="flex flex-wrap gap-2" role={activeTag ? 'radiogroup' : undefined} aria-label={activeTag ? 'Tag search scope' : undefined}>
              {activeTag ? (
                SEARCH_SCOPES.map(option => {
                  const selected = scope === option.id
                  return (
                    <button
                      key={option.id}
                      id={searchScopeRadioId(option.id)}
                      type="button"
                      role="radio"
                      className="rr-tag"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setScope(option.id)}
                      onKeyDown={e => onScopeKeyDown(e, option.id)}
                      style={{
                        borderColor: selected ? 'var(--accent)' : undefined,
                        color: selected ? 'var(--accent)' : undefined,
                      }}
                    >
                      {option.id === 'current' ? activeTagLabel ?? activeTag : option.label}
                    </button>
                  )
                })
              ) : (
                <span className="rr-tag">All cards</span>
              )}
            </div>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-auto px-5 py-3">
          {mode === 'ai' && !q.trim() && (
            <p className="rr-prose py-6 text-center" style={{ fontSize: '0.92rem' }}>
              Search by meaning across local full-card embeddings.
            </p>
          )}
          {mode === 'text' && !q.trim() && visibleRecentSearches.length > 0 && (
            <RecentSearchList searches={visibleRecentSearches} onPick={replaySearch} onClear={clearRecentSearches} />
          )}
          {mode === 'text' && !q.trim() && visibleRecentSearches.length === 0 && (
            <p className="rr-prose py-6 text-center" style={{ fontSize: '0.92rem' }}>
              Recent exact-text searches will appear here.
            </p>
          )}
          {searchError && <p className="rr-prose py-4 text-center" style={{ fontSize: '0.92rem' }}>{searchError}</p>}
          {loading && <p className="rr-mono py-4">{semanticMode ? 'embedding query…' : 'searching…'}</p>}
          {!loading && !searchError && q.trim() && results.length === 0 && (
            <p className="rr-mono py-4">{scopedTag ? 'no matches in this tag' : semanticMode ? 'no semantic matches' : 'no matches'}</p>
          )}
          {results.map(c => (
            <Link
              key={c.id}
              href={`/item/${c.id}`}
              onClick={onClose}
              className="block py-3 rr-rule"
            >
              <div className="font-display" style={{ fontSize: '1.05rem', overflowWrap: 'anywhere' }}>{c.title}</div>
              {c.summary && <div className="rr-prose" style={{ fontSize: '0.88rem', overflowWrap: 'anywhere' }}>{c.summary.slice(0, 140)}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rr-mono" style={{ overflowWrap: 'anywhere' }}>{c.provider ?? c.sourceType}</span>
                {c.shared && <span className="rr-tag" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>Shared</span>}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function RecentSearchList({
  searches,
  onPick,
  onClear,
}: {
  searches: RecentSearch[]
  onPick: (search: RecentSearch) => void
  onClear: () => void
}) {
  const groups = groupRecentSearches(searches)

  return (
    <div className="py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="rr-mono">Recent searches</span>
        <button
          type="button"
          className="rr-mono rr-link"
          onClick={onClear}
          aria-label="Clear all recent exact-text searches"
          title="Clear locally saved exact-text search history"
        >
          Clear all
        </button>
      </div>
      {groups.map(group => (
        <section key={group.label} className="py-2">
          <div className="rr-mono mb-1" style={{ color: 'var(--gold)' }}>{group.label}</div>
          <div className="space-y-1">
            {group.searches.map(search => (
              <button
                key={`${search.query}-${search.scope}-${search.tag ?? 'all'}-${search.at}`}
                type="button"
                onClick={() => onPick(search)}
                className="block w-full text-left py-2 rr-rule"
              >
                <span className="font-display block" style={{ fontSize: '1rem', overflowWrap: 'anywhere' }}>{search.query}</span>
                <span className="rr-mono">
                  {search.tagLabel ? `in ${search.tagLabel}` : 'All cards'} · {searchSurfaceLabel(search.surfaces)} · {dateFilterLabel(search.dateFilter)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null)
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error
  }
  return fallback
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function searchModeTabId(mode: 'text' | 'ai'): string {
  return `search-mode-tab-${mode}`
}

function searchModePanelId(mode: 'text' | 'ai'): string {
  return `search-mode-panel-${mode}`
}

function searchScopeRadioId(scope: SearchScope): string {
  return `search-scope-radio-${scope}`
}

function readRecentSearches(): RecentSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeRecentSearch).filter((item): item is RecentSearch => item !== null).slice(0, 12)
  } catch {
    return []
  }
}

function rememberSearch(next: RecentSearch): RecentSearch[] {
  const searches = [next, ...readRecentSearches().filter(existing => !isSameRecentSearch(existing, next))].slice(0, 12)
  try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches)) } catch {}
  return searches
}

function isSameRecentSearch(a: RecentSearch, b: RecentSearch): boolean {
  return a.query.toLowerCase() === b.query.toLowerCase()
    && a.scope === b.scope
    && a.tag === b.tag
    && sameSearchSurfaces(a.surfaces, b.surfaces)
    && normalizeDateFilter(a.dateFilter) === normalizeDateFilter(b.dateFilter)
}

function sameSearchSurfaces(a: SearchSurface[] = DEFAULT_SEARCH_IN, b: SearchSurface[] = DEFAULT_SEARCH_IN): boolean {
  const normalizedA = normalizeSearchSurfaces(a)
  const normalizedB = normalizeSearchSurfaces(b)
  return normalizedA.length === normalizedB.length && normalizedA.every(surface => normalizedB.includes(surface))
}

function normalizeRecentSearch(value: unknown): RecentSearch | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    typeof item.query !== 'string'
    || (item.scope !== 'current' && item.scope !== 'all')
    || (typeof item.tag !== 'string' && item.tag !== null)
    || (typeof item.tagLabel !== 'string' && item.tagLabel !== null)
    || typeof item.at !== 'string'
  ) return null

  return {
    query: item.query,
    scope: item.scope,
    tag: item.tag,
    tagLabel: item.tagLabel,
    surfaces: normalizeSearchSurfaces(item.surfaces),
    dateFilter: normalizeDateFilter(item.dateFilter),
    at: item.at,
  }
}

function normalizeSearchSurfaces(value: unknown): SearchSurface[] {
  if (!Array.isArray(value)) return DEFAULT_SEARCH_IN
  const allowed = new Set<SearchSurface>(['notebook', 'reader', 'quiz'])
  const surfaces = value.filter((item): item is SearchSurface => allowed.has(item as SearchSurface))
  return surfaces.length > 0 ? surfaces : DEFAULT_SEARCH_IN
}

function normalizeDateFilter(value: unknown): DateFilter {
  return value === 'today' || value === 'week' || value === 'month' ? value : 'any'
}

function searchSurfaceLabel(surfaces: SearchSurface[] = DEFAULT_SEARCH_IN): string {
  if (surfaces.length === DEFAULT_SEARCH_IN.length) return 'Notebook, Reader, Quiz'
  return surfaces.map(surface => SEARCH_SURFACES.find(item => item.id === surface)?.label ?? surface).join(', ')
}

function dateFilterLabel(filter: DateFilter = 'any'): string {
  if (filter === 'today') return 'Today'
  if (filter === 'week') return 'Last 7 days'
  if (filter === 'month') return 'Last 30 days'
  return 'Any time'
}

function groupRecentSearches(searches: RecentSearch[]): { label: string; searches: RecentSearch[] }[] {
  const groups = new Map<string, RecentSearch[]>()
  for (const search of searches) {
    const label = recentSearchDateLabel(search.at)
    groups.set(label, [...(groups.get(label) ?? []), search])
  }
  return [...groups.entries()].map(([label, grouped]) => ({ label, searches: grouped }))
}

function recentSearchDateLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Earlier'
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = startOfDay(now)
  const searchDay = startOfDay(date)
  if (searchDay === today) return 'Today'
  if (searchDay === today - 86400000) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
