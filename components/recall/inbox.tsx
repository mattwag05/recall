'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Archive, ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Inbox as InboxIcon, Pencil, Star, Tag } from 'lucide-react'
import { errorMessage } from '@/lib/api-client'
import { isShortcutTarget } from '@/lib/shortcuts'
import { relativeTime, type TagNode } from '@/lib/recall-types'
import type { TriageStatus } from '@/lib/triage'
import { toast } from './toaster'

export type InboxCard = {
  id: string
  title: string
  text: string
  provider: string | null
  url: string
  summary: string | null
  status: string
  sourceType: string
  thumbnail: string | null
  notes: string | null
  createdAt: string
  tags: { name: string; slug: string; color: string }[]
}

const SHORTCUT_HINTS: { keys: string; label: string }[] = [
  { keys: 'n', label: 'next' },
  { keys: 'p', label: 'prev' },
  { keys: 'r', label: 'reviewed' },
  { keys: 's', label: 'pin' },
  { keys: 'a', label: 'archive' },
  { keys: 'e', label: 'open' },
]

/** Fires so the nav badge can decrement without waiting for its 60s poll. */
function announceInboxChange() {
  window.dispatchEvent(new CustomEvent('inbox-updated'))
}

export function InboxReview() {
  const router = useRouter()
  const [cards, setCards] = useState<InboxCard[]>([])
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)
  const [tags, setTags] = useState<TagNode[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)

  const card = cards[index] ?? null

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load the inbox')
      if (!Array.isArray(data.cards)) throw new Error('The local inbox API returned an unexpected response.')
      setCards(data.cards)
      setTotal(typeof data.total === 'number' ? data.total : data.cards.length)
      setIndex(0)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load the inbox. Check that Recall is still running, then try again.'))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/tags')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data.tags)) setTags(data.tags) })
      .catch(() => {})
  }, [])

  // Close the per-card editors whenever the card under review changes.
  useEffect(() => {
    setNoteOpen(false)
    setTagPickerOpen(false)
    setNoteDraft(card?.notes ?? '')
  }, [card?.id, card?.notes])

  const move = useCallback((delta: number) => {
    setIndex(current => Math.min(Math.max(current + delta, 0), Math.max(cards.length - 1, 0)))
  }, [cards.length])

  const triage = useCallback(async (status: TriageStatus) => {
    if (!card || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triageStatus: status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(data.error || 'Could not update that card.')
        return
      }
      // Drop it locally instead of refetching, so the queue never jumps.
      setCards(prev => {
        const next = prev.filter(c => c.id !== card.id)
        setIndex(i => Math.min(i, Math.max(next.length - 1, 0)))
        return next
      })
      setTotal(prev => Math.max(prev - 1, 0))
      announceInboxChange()
      toast(status === 'reviewed' ? 'Reviewed' : status === 'pinned' ? 'Pinned' : 'Archived')
    } catch {
      toast('Could not reach Recall. Check that it is still running, then try again.')
    } finally {
      setBusy(false)
    }
  }, [card, busy])

  const openCard = useCallback(() => {
    if (card) router.push(`/item/${card.id}`)
  }, [card, router])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        setNoteOpen(false)
        setTagPickerOpen(false)
        return
      }
      if (isShortcutTarget(e.target)) return
      switch (e.key) {
        case 'n': case 'ArrowRight': e.preventDefault(); move(1); break
        case 'p': case 'ArrowLeft': e.preventDefault(); move(-1); break
        case 'r': e.preventDefault(); triage('reviewed'); break
        case 's': e.preventDefault(); triage('pinned'); break
        case 'a': e.preventDefault(); triage('archived'); break
        case 'e': e.preventDefault(); openCard(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, triage, openCard])

  async function saveNote() {
    if (!card) return
    try {
      const res = await fetch(`/api/cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: noteDraft }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || 'Could not save that note.')
        return
      }
      setCards(prev => prev.map(c => (c.id === card.id ? { ...c, notes: noteDraft } : c)))
      setNoteOpen(false)
      toast('Note saved')
    } catch {
      toast('Could not save that note. Check that Recall is still running.')
    }
  }

  async function toggleTag(slug: string, name: string, attached: boolean) {
    if (!card) return
    try {
      const res = attached
        ? await fetch(`/api/cards/${card.id}/tags?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
        : await fetch(`/api/cards/${card.id}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || 'Could not update tags.')
        return
      }
      // POST answers with the (possibly newly created) tag, so take its real colour.
      const data = await res.json().catch(() => ({}))
      const added = data?.tag as InboxCard['tags'][number] | undefined
      const nextTags: InboxCard['tags'] = attached
        ? card.tags.filter(t => t.slug !== slug)
        : [...card.tags, added ?? { name, slug, color: 'var(--sepia-2)' }]
      setCards(prev => prev.map(c => (c.id === card.id ? { ...c, tags: nextTags } : c)))
    } catch {
      toast('Could not update tags. Check that Recall is still running.')
    }
  }

  if (!loaded) {
    return <p className="rr-mono px-6 py-10">opening the inbox…</p>
  }

  if (error) {
    return (
      <div className="rr-card mx-auto my-10 max-w-xl p-6 text-center">
        <p className="rr-prose">{error}</p>
        <button className="rr-btn mt-4" onClick={() => load()}>Try again</button>
      </div>
    )
  }

  if (!card) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <InboxIcon size={48} aria-hidden="true" className="mx-auto" style={{ color: 'var(--card-edge)', strokeWidth: 1.4 }} />
        <h2 className="font-display mt-5" style={{ fontSize: '1.6rem' }}>Inbox Zero</h2>
        <p className="rr-prose mt-2">Everything saved has been triaged. Nice.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/items" className="rr-btn">Back to library</Link>
        </div>
      </div>
    )
  }

  const remaining = Math.max(total - index, 0)
  const progress = total > 0 ? ((total - remaining + 1) / total) * 100 : 100
  const flatTags = flattenTagTree(tags)
  const attachedSlugs = new Set(card.tags.map(t => t.slug))

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 md:px-6">
      <header className="sticky top-0 z-20 -mx-4 mb-6 border-b border-[var(--hairline)] bg-[var(--paper)]/95 px-4 pt-6 pb-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="font-display" style={{ fontSize: '1.9rem' }}>Inbox</h1>
            <p className="rr-mono mt-1">{remaining} of {total} to review</p>
          </div>
          <Link href="/items" className="rr-mono rr-link">← Library</Link>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--hairline)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {SHORTCUT_HINTS.map(hint => (
            <span key={hint.keys} className="rr-mono flex items-center gap-1.5">
              <kbd
                className="rounded border px-1.5 py-0.5 font-mono text-[0.68rem]"
                style={{ borderColor: 'var(--btn-hover-edge)', background: 'var(--card)', color: 'var(--sepia)' }}
              >
                {hint.keys}
              </kbd>
              {hint.label}
            </span>
          ))}
        </div>
      </header>

      <article className="rr-card rr-rise overflow-hidden">
        {card.thumbnail && (
          <div className="relative w-full" style={{ aspectRatio: '16 / 7' }}>
            <Image src={card.thumbnail} alt="" fill sizes="(max-width: 768px) 100vw, 768px" className="object-cover" unoptimized />
          </div>
        )}
        <div className="p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {card.provider && <span className="rr-tag">{card.provider}</span>}
            <span className="rr-tag">{card.sourceType}</span>
            {card.status === 'failed' && (
              <span className="rr-tag" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>needs attention</span>
            )}
            <span className="rr-mono">{relativeTime(card.createdAt)}</span>
          </div>

          <h2 className="font-display mt-3" style={{ fontSize: '1.45rem', lineHeight: 1.25 }}>{card.title}</h2>

          {card.summary
            ? <p className="rr-prose mt-3">{card.summary}</p>
            : <p className="rr-prose mt-3" style={{ display: '-webkit-box', WebkitLineClamp: 8, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.text}</p>}

          {card.url && (
            <a href={card.url} target="_blank" rel="noreferrer noopener" className="rr-link rr-mono mt-4 inline-flex items-center gap-1.5">
              <ExternalLink size={13} aria-hidden="true" />
              Open original
            </a>
          )}

          {card.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {card.tags.map(tag => (
                <span key={tag.slug} className="rr-tag" style={{ borderColor: tag.color }}>{tag.name}</span>
              ))}
            </div>
          )}

          {card.notes && !noteOpen && (
            <div className="mt-4 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--hairline)', background: 'var(--paper)' }}>
              <p className="rr-mono">Note</p>
              <p className="rr-prose mt-1" style={{ fontSize: '0.92rem' }}>{card.notes}</p>
            </div>
          )}

          {noteOpen && (
            <div className="mt-4">
              <label className="rr-mono" htmlFor="inbox-note">Why does this matter?</label>
              <textarea
                id="inbox-note"
                autoFocus
                rows={3}
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                className="rr-input mt-2 w-full"
                style={{ resize: 'vertical' }}
              />
              <div className="mt-2 flex gap-2">
                <button className="rr-btn rr-btn-accent" onClick={saveNote}>Save note</button>
                <button className="rr-btn" onClick={() => { setNoteOpen(false); setNoteDraft(card.notes ?? '') }}>Cancel</button>
              </div>
            </div>
          )}

          {tagPickerOpen && (
            <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--hairline)', background: 'var(--paper)' }}>
              <p className="rr-mono">Tags</p>
              {flatTags.length === 0
                ? <p className="rr-prose mt-2" style={{ fontSize: '0.9rem' }}>No tags yet — enrichment creates them.</p>
                : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {flatTags.map(tag => {
                      const attached = attachedSlugs.has(tag.slug)
                      return (
                        <button
                          key={tag.slug}
                          type="button"
                          className="rr-tag"
                          aria-pressed={attached}
                          onClick={() => toggleTag(tag.slug, tag.name, attached)}
                          style={attached ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                          {attached ? '✓ ' : ''}{tag.label}
                        </button>
                      )
                    })}
                  </div>
                )}
            </div>
          )}
        </div>
      </article>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button className="rr-btn rr-btn-accent rr-btn-icon" disabled={busy} onClick={() => triage('reviewed')}>
          <CheckCircle2 size={14} aria-hidden="true" /><span>Reviewed</span>
        </button>
        <button className="rr-btn rr-btn-icon" disabled={busy} onClick={() => triage('pinned')}>
          <Star size={14} aria-hidden="true" /><span>Pin</span>
        </button>
        <button className="rr-btn rr-btn-icon" disabled={busy} onClick={() => triage('archived')}>
          <Archive size={14} aria-hidden="true" /><span>Archive</span>
        </button>
        <button className="rr-btn" aria-expanded={noteOpen} onClick={() => setNoteOpen(open => !open)}>Note</button>
        <button className="rr-btn rr-btn-icon" aria-expanded={tagPickerOpen} onClick={() => setTagPickerOpen(open => !open)}>
          <Tag size={14} aria-hidden="true" /><span>Tags</span>
        </button>
        <Link href={`/item/${card.id}`} className="rr-btn rr-btn-icon">
          <Pencil size={14} aria-hidden="true" /><span>Open card</span>
        </Link>
        <div className="ml-auto flex gap-2">
          <button className="rr-btn rr-btn-icon" onClick={() => move(-1)} disabled={index === 0} aria-label="Previous card">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <button className="rr-btn rr-btn-icon" onClick={() => move(1)} disabled={index >= cards.length - 1} aria-label="Next card">
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

function flattenTagTree(nodes: TagNode[], trail: string[] = []): { slug: string; name: string; label: string }[] {
  return nodes.flatMap(node => {
    const path = [...trail, node.name]
    return [
      { slug: node.slug, name: node.name, label: path.join(' / ') },
      ...flattenTagTree(node.children, path),
    ]
  })
}
