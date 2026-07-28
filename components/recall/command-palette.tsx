'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Brain, CornerDownLeft, FileText, Inbox, MessageCircle, Search, Settings } from 'lucide-react'
import { useDialogFocus } from '@/lib/use-dialog-focus'
import { cardTitle } from '@/lib/format'

// ponytail: this and SearchModal both search cards. SearchModal is deep (modes,
// surfaces, scopes) but lives inside Library and is wired to its state; the
// palette is global and deliberately shallow — page nav plus the top few cards.
// Fold them together if SearchModal ever becomes global.

type PageTarget = { label: string; href: string; icon: typeof BookOpen; hint: string }

const PAGES: PageTarget[] = [
  { label: 'Library', href: '/items', icon: BookOpen, hint: 'all cards' },
  { label: 'Inbox', href: '/inbox', icon: Inbox, hint: 'triage new cards' },
  { label: 'Chat', href: '/chat', icon: MessageCircle, hint: 'ask your library' },
  { label: 'Review', href: '/spaced-repetition', icon: Brain, hint: 'spaced repetition' },
  { label: 'Settings', href: '/settings', icon: Settings, hint: 'models, theme, export' },
]

const MAX_CARD_RESULTS = 8
const SEARCH_DEBOUNCE_MS = 300

type CardHit = { id: string; title: string; provider: string | null }

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<CardHit[]>([])
  const [active, setActive] = useState(0)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  useDialogFocus(open, dialogRef)

  // Cmd/Ctrl+K toggles from anywhere, including while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) return
    setQuery('')
    setCards([])
    setActive(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = query.trim()
    if (!term) {
      setCards([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/cards?query=${encodeURIComponent(term)}&mode=text`, { signal: controller.signal })
        .then(res => res.json())
        .then(data => {
          if (!Array.isArray(data.cards)) return
          setCards(data.cards.slice(0, MAX_CARD_RESULTS).map((c: { id: string; title: string | null; text?: string; provider: string | null }) => ({
            id: c.id,
            title: cardTitle(c.title, c.text ?? ''),
            provider: c.provider,
          })))
        })
        .catch(() => {})
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, open])

  if (!open) return null

  const term = query.trim().toLowerCase()
  const pages = term
    ? PAGES.filter(p => p.label.toLowerCase().includes(term) || p.hint.includes(term))
    : PAGES
  const items: ({ kind: 'page' } & PageTarget | { kind: 'card' } & CardHit)[] = [
    ...pages.map(p => ({ kind: 'page' as const, ...p })),
    ...cards.map(c => ({ kind: 'card' as const, ...c })),
  ]
  const clamped = Math.min(active, Math.max(items.length - 1, 0))

  function go(index: number) {
    const item = items[index]
    if (!item) return
    setOpen(false)
    router.push(item.kind === 'page' ? item.href : `/item/${item.id}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1) }
    if (e.key === 'Enter') { e.preventDefault(); go(clamped) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={() => setOpen(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="rr-card rr-rise w-full max-w-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 rr-rule">
          <Search size={16} aria-hidden="true" style={{ color: 'var(--sepia)' }} />
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            placeholder="Jump to a page, or search your cards…"
            aria-label="Command palette search"
            aria-controls="command-palette-results"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>

        <div id="command-palette-results" ref={listRef} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto py-2">
          {items.length === 0 && (
            <p className="rr-prose px-4 py-6 text-center" style={{ fontSize: '0.92rem' }}>
              Nothing matches “{query.trim()}”.
            </p>
          )}

          {pages.length > 0 && <p className="rr-mono px-4 pt-1 pb-1">Pages</p>}
          {pages.map((page, i) => (
            <PaletteRow
              key={page.href}
              icon={page.icon}
              label={page.label}
              hint={page.hint}
              selected={clamped === i}
              onSelect={() => go(i)}
              onHover={() => setActive(i)}
            />
          ))}

          {cards.length > 0 && <p className="rr-mono px-4 pt-3 pb-1">Cards</p>}
          {cards.map((card, i) => (
            <PaletteRow
              key={card.id}
              icon={FileText}
              label={card.title}
              hint={card.provider ?? ''}
              selected={clamped === pages.length + i}
              onSelect={() => go(pages.length + i)}
              onHover={() => setActive(pages.length + i)}
            />
          ))}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 rr-mono" style={{ borderTop: '1px solid var(--hairline)' }}>
          <span className="flex items-center gap-1"><Key>↑</Key><Key>↓</Key> navigate</span>
          <span className="flex items-center gap-1"><Key><CornerDownLeft size={10} aria-hidden="true" /></Key> open</span>
          <span className="flex items-center gap-1"><Key>esc</Key> close</span>
        </div>
      </div>
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[0.66rem]"
      style={{ borderColor: 'var(--btn-hover-edge)', background: 'var(--paper)', color: 'var(--sepia)' }}
    >
      {children}
    </kbd>
  )
}

function PaletteRow({
  icon: Icon,
  label,
  hint,
  selected,
  onSelect,
  onHover,
}: {
  icon: typeof BookOpen
  label: string
  hint: string
  selected: boolean
  onSelect: () => void
  onHover: () => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={onHover}
      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm"
      style={{
        background: selected ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
        color: selected ? 'var(--accent)' : 'var(--ink-soft)',
      }}
    >
      <Icon size={15} aria-hidden="true" style={{ flex: '0 0 auto' }} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="rr-mono shrink-0">{hint}</span>}
    </button>
  )
}
