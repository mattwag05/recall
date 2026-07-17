'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AtSign, Check, Eye, Link2, Maximize2, MessageCircle, Minus, MoreHorizontal, Pencil, Plus, RotateCcw, Settings, SlidersHorizontal, Trash2, Type, X } from 'lucide-react'
import { markdownHeadings, renderMarkdown, renderReader } from '@/lib/markdown-render'
import { READING_SIZES, readReadingSize, writeReadingSize, type ReadingSize } from '@/lib/reading-preferences'
import { readTtsVoice } from '@/lib/tts-preferences'
import { toast } from './toaster'
import { relativeTime, type CardDetail, type CardGraph, type CardQuizQuestion, type ChatAnswer, type ChatCitation, type RelatedCard } from '@/lib/recall-types'
import { ChatAttachmentControl, type ChatAttachmentDraft } from './chat-attachments'

type Tab = 'notebook' | 'reader' | 'chat' | 'quiz' | 'connections' | 'graph'
type GraphDepth = 1 | 2 | 3
type GraphFitMode = 'spread' | 'fit'
type GraphNodeKind = 'related' | 'manual-card' | 'incoming-card' | 'linked-card' | 'entity' | 'context'
type GraphEdgeKind = 'manual' | 'incoming' | 'linked' | 'entity' | 'related' | 'context'
type ReaderMode = 'original' | 'reformatted'

const TIMED_QUIZ_SECONDS = 60

type GraphNode = {
  id: string
  label: string
  type: string
  kind: GraphNodeKind
  graphId?: string
  fromGraphId?: string
  href?: string
  score?: number
  origin?: string
  direction?: 'outbound' | 'inbound'
  depth?: number
}

type PositionedGraphNode = GraphNode & {
  x: number
  y: number
}

type GraphRenderEdge = {
  id: string
  fromNodeId: string
  toNodeId: string
  fromLabel: string
  toLabel: string
  label: string
  kind: GraphEdgeKind
  origin?: string
  entityType?: string
  depth?: number
}

const TABS: {
  id: Tab
  label: string
  planned?: boolean
  plannedPhase?: string
  plannedTitle?: string
}[] = [
  { id: 'notebook', label: 'Notebook' },
  { id: 'reader', label: 'Reader' },
  {
    id: 'chat',
    label: 'Chat',
    plannedTitle: 'Card chat uses local RAG over the current card and selected Recall context with cited saved-card sources.',
  },
  {
    id: 'quiz',
    label: 'Quiz',
    plannedTitle: 'Generate or create short-answer questions, run a local card quiz, and update review scheduling from self-graded answers.',
  },
  {
    id: 'connections',
    label: 'Connections',
    plannedTitle: 'Related cards, manual links, generated local entity links, backlinks, return links, and automatic local generation are live.',
  },
  {
    id: 'graph',
    label: 'Graph',
    plannedTitle: 'The graph visualizes related cards, multi-hop local connections, generated entity links, filters, fit, and fullscreen controls.',
  },
]

export function CardDetailView({
  id,
  initialTab,
  initialQuizStart = false,
}: {
  id: string
  initialTab?: string
  initialQuizStart?: boolean
}) {
  const router = useRouter()
  const [card, setCard] = useState<CardDetail | null>(null)
  const [tab, setTab] = useState<Tab>(() => parseInitialTab(initialTab))
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingNotebook, setEditingNotebook] = useState(false)
  const [notebookDraft, setNotebookDraft] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addingTag, setAddingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [exportingMarkdown, setExportingMarkdown] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [tagMutating, setTagMutating] = useState(false)
  const [readingSize, setReadingSize] = useState<ReadingSize>('regular')
  const [relatedCards, setRelatedCards] = useState<RelatedCard[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [relatedError, setRelatedError] = useState<string | null>(null)
  const [relatedLoadedFor, setRelatedLoadedFor] = useState<string | null>(null)
  const [manualLinkDraft, setManualLinkDraft] = useState('')
  const [connectionMutating, setConnectionMutating] = useState(false)
  const [generatingConnections, setGeneratingConnections] = useState(false)
  const [generatingQuestions, setGeneratingQuestions] = useState(false)
  const [questionMutating, setQuestionMutating] = useState(false)
  const [menuActionBusy, setMenuActionBusy] = useState(false)
  const [processingStalled, setProcessingStalled] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const tagMutationRef = useRef(false)
  const processingStartRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cards/${id}`)
      if (res.status === 404) {
        setNotFound(true)
        setLoadError(null)
        setCard(null)
        return
      }
      if (!res.ok) {
        setLoadError(await readApiError(res, 'Could not open this card. Try again, or return to the library.'))
        return
      }
      const data = await res.json().catch(() => null)
      if (!data || typeof data !== 'object' || !('card' in data) || !data.card) {
        setLoadError('The local API returned an unexpected card response. Try again, or return to the library.')
        return
      }
      setCard(data.card)
      setTitleDraft(data.card.title)
      if (!editingNotebook) setNotebookDraft(data.card.notebookContent)
      setNotFound(false)
      setLoadError(null)
    } catch {
      setLoadError('Could not open this card. Check that the local app is still running, then try again.')
    }
  }, [id, editingNotebook])

  const loadRelated = useCallback(async () => {
    setRelatedLoading(true)
    setRelatedError(null)
    try {
      const res = await fetch(`/api/cards/${id}/related?limit=6`)
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Could not rank related cards. Check that the local embedding model is running, then try again.'))
      }
      const data = await res.json().catch(() => null)
      const cards = data && typeof data === 'object' ? (data as { cards?: unknown }).cards : null
      if (!Array.isArray(cards)) {
        throw new Error('The local related-cards API returned an unexpected response. Try again.')
      }
      setRelatedCards(cards as RelatedCard[])
      setRelatedLoadedFor(id)
    } catch (err) {
      setRelatedCards([])
      setRelatedError(errorMessage(err, 'Could not rank related cards. Check that the local embedding model is running, then try again.'))
      setRelatedLoadedFor(id)
    } finally {
      setRelatedLoading(false)
    }
  }, [id])

  useEffect(() => { setReadingSize(readReadingSize()) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    setRelatedCards([])
    setRelatedError(null)
    setRelatedLoadedFor(null)
  }, [id])

  // Poll while a card is processing, but cap it: a card stuck organizing/
  // summarizing past PROCESSING_CAP_MS stops polling and surfaces a Retry escape.
  useEffect(() => {
    if (!card) return
    const isProcessing = card.status === 'organizing' || card.status === 'summarizing'
    if (!isProcessing) {
      processingStartRef.current = null
      if (processingStalled) setProcessingStalled(false)
      return
    }
    if (processingStartRef.current === null) processingStartRef.current = Date.now()
    const PROCESSING_CAP_MS = 120000
    if (Date.now() - processingStartRef.current >= PROCESSING_CAP_MS) {
      setProcessingStalled(true)
      return
    }
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [card, load, processingStalled])

  useEffect(() => {
    if (!card || relatedLoading || relatedLoadedFor === id) return
    if (tab === 'connections' || tab === 'graph') loadRelated()
  }, [card, id, tab, relatedLoading, relatedLoadedFor, loadRelated])

  useEffect(() => {
    if (!menuOpen) return
    window.setTimeout(() => focusFirstMenuItem(menuRef.current), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setMenuOpen(false)
      menuButtonRef.current?.focus()
      return
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()

    const items = menuItems(menuRef.current)
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

  async function patch(data: Record<string, string>, note?: string) {
    try {
      const res = await fetch(`/api/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const d = await res.json().catch(() => null)
      toast(res.ok && isOkResponse(d) ? (note ?? 'Changes saved') : apiError(d, res.ok ? 'The local API returned an unexpected save response' : 'Could not save changes'))
    } catch {
      toast('Could not save changes')
    } finally {
      load()
    }
  }

  async function addTag(name: string) {
    const n = name.trim()
    if (!n || tagMutationRef.current) return
    tagMutationRef.current = true
    setTagMutating(true)
    setTagDraft(''); setAddingTag(false)
    try {
      const res = await fetch(`/api/cards/${id}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }),
      })
      const d = await res.json().catch(() => null)
      toast(res.ok && isOkResponse(d) ? `Tagged “${n}”` : apiError(d, res.ok ? 'The local tag API returned an unexpected add response' : 'Could not add tag'))
    } catch {
      toast('Could not add tag')
    } finally {
      tagMutationRef.current = false
      setTagMutating(false)
      load()
    }
  }

  async function removeTag(slug: string) {
    if (tagMutationRef.current) return
    tagMutationRef.current = true
    setTagMutating(true)
    try {
      const res = await fetch(`/api/cards/${id}/tags?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
      const d = await res.json().catch(() => null)
      toast(res.ok && isOkResponse(d) ? 'Tag removed' : apiError(d, res.ok ? 'The local tag API returned an unexpected remove response' : 'Could not remove tag'))
    } catch {
      toast('Could not remove tag')
    } finally {
      tagMutationRef.current = false
      setTagMutating(false)
      load()
    }
  }

  async function regenerate() {
    if (card?.notebookContent.trim()) {
      const ok = confirm('Regenerate this notebook? The current notebook text will be replaced.')
      if (!ok) return
    }
    setRegenerating(true); toast('Regenerating notebook…')
    try {
      const res = await fetch(`/api/cards/${id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace: true }),
      })
      const d = await res.json().catch(() => null)
      toast(res.ok && isOkResponse(d) ? 'Notebook regenerated' : apiError(d, res.ok ? 'The local regenerate API returned an unexpected response' : 'Regeneration failed'))
    } catch {
      toast('Regeneration failed')
    } finally {
      setRegenerating(false); load()
    }
  }

  async function retry() {
    // Give a retried card a fresh processing window before it's "stalled" again.
    processingStartRef.current = null
    setProcessingStalled(false)
    setRetrying(true); toast('Retrying extraction…')
    try {
      const res = await fetch(`/api/cards/${id}/retry`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      toast(res.ok && isOkResponse(d) ? 'Re-extracted & enriched' : apiError(d, res.ok ? 'The local retry API returned an unexpected response' : 'Retry failed'))
    } catch {
      toast('Retry failed')
    } finally {
      setRetrying(false); load()
    }
  }

  async function createManualConnection(input: { targetId?: string; targetTitle?: string; label?: string }) {
    if (connectionMutating) return
    setConnectionMutating(true)
    try {
      const res = await fetch(`/api/cards/${id}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && isOkResponse(d)) {
        toast('Card link saved')
        setManualLinkDraft('')
      } else {
        toast(apiError(d, res.ok ? 'The local connection API returned an unexpected response' : 'Could not save card link'))
      }
    } catch {
      toast('Could not save card link')
    } finally {
      setConnectionMutating(false)
      load()
    }
  }

  async function removeConnection(connectionId: string) {
    if (connectionMutating) return
    setConnectionMutating(true)
    try {
      const res = await fetch(`/api/cards/${id}/connections?connectionId=${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
      const d = await res.json().catch(() => null)
      toast(res.ok && isOkResponse(d) ? 'Card link removed' : apiError(d, res.ok ? 'The local connection API returned an unexpected remove response' : 'Could not remove card link'))
    } catch {
      toast('Could not remove card link')
    } finally {
      setConnectionMutating(false)
      load()
    }
  }

  async function generateConnections() {
    if (generatingConnections) return
    setGeneratingConnections(true)
    try {
      const res = await fetch(`/api/cards/${id}/connections/generate`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (res.ok && isGeneratedConnectionsResponse(d)) {
        toast(d.created > 0 ? `Generated ${d.created} entity links` : 'Entity links are already up to date')
      } else {
        toast(apiError(d, res.ok ? 'The local connection API returned an unexpected generate response' : 'Could not generate entity links'))
      }
    } catch {
      toast('Could not generate entity links')
    } finally {
      setGeneratingConnections(false)
      load()
    }
  }

  async function generateQuestions() {
    if (generatingQuestions) return
    setGeneratingQuestions(true)
    try {
      const res = await fetch(`/api/cards/${id}/questions/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5 }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && isGeneratedQuestionsResponse(d)) {
        toast(d.created > 0 ? `Generated ${d.created} quiz questions` : 'Quiz questions are already up to date')
      } else {
        toast(apiError(d, res.ok ? 'The local quiz API returned an unexpected response' : 'Could not generate quiz questions'))
      }
    } catch {
      toast('Could not generate quiz questions')
    } finally {
      setGeneratingQuestions(false)
      load()
    }
  }

  async function createManualQuestion(input: { prompt: string; answer: string }): Promise<boolean> {
    if (questionMutating) return false
    setQuestionMutating(true)
    try {
      const res = await fetch(`/api/cards/${id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && isCreatedQuestionResponse(d)) {
        toast('Custom quiz question saved')
        await load()
        return true
      }
      toast(apiError(d, res.ok ? 'The local quiz API returned an unexpected create response' : 'Could not save quiz question'))
      return false
    } catch {
      toast('Could not save quiz question')
      return false
    } finally {
      setQuestionMutating(false)
    }
  }

  async function updateQuestion(questionId: string, input: { prompt: string; answer: string }): Promise<boolean> {
    if (questionMutating) return false
    setQuestionMutating(true)
    try {
      const res = await fetch(`/api/cards/${id}/questions/${questionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && isQuestionMutationResponse(d)) {
        toast('Quiz question updated')
        await load()
        return true
      }
      toast(apiError(d, res.ok ? 'The local quiz API returned an unexpected update response' : 'Could not update quiz question'))
      return false
    } catch {
      toast('Could not update quiz question')
      return false
    } finally {
      setQuestionMutating(false)
    }
  }

  async function deleteQuestion(questionId: string): Promise<boolean> {
    if (questionMutating) return false
    const ok = confirm('Delete this quiz question?')
    if (!ok) return false
    setQuestionMutating(true)
    try {
      const res = await fetch(`/api/cards/${id}/questions/${questionId}`, { method: 'DELETE' })
      const d = await res.json().catch(() => null)
      if (res.ok && isDeletedQuestionResponse(d)) {
        toast('Quiz question deleted')
        await load()
        return true
      }
      toast(apiError(d, res.ok ? 'The local quiz API returned an unexpected delete response' : 'Could not delete quiz question'))
      return false
    } catch {
      toast('Could not delete quiz question')
      return false
    } finally {
      setQuestionMutating(false)
    }
  }

  async function reviewQuestion(questionId: string, correct: boolean): Promise<boolean> {
    if (questionMutating) return false
    setQuestionMutating(true)
    try {
      const res = await fetch(`/api/cards/${id}/questions/${questionId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && isReviewedQuestionResponse(d)) {
        toast(correct ? 'Marked correct' : 'Marked for more practice')
        await load()
        return true
      }
      toast(apiError(d, res.ok ? 'The local quiz API returned an unexpected review response' : 'Could not record quiz answer'))
      return false
    } catch {
      toast('Could not record quiz answer')
      return false
    } finally {
      setQuestionMutating(false)
    }
  }

  async function reviewQuestions(results: { questionId: string; correct: boolean }[]): Promise<boolean> {
    if (questionMutating || results.length === 0) return false
    setQuestionMutating(true)
    try {
      for (const result of results) {
        const res = await fetch(`/api/cards/${id}/questions/${result.questionId}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ correct: result.correct }),
        })
        const d = await res.json().catch(() => null)
        if (!res.ok || !isReviewedQuestionResponse(d)) {
          toast(apiError(d, res.ok ? 'The local quiz API returned an unexpected review response' : 'Could not record matching answers'))
          await load()
          return false
        }
      }
      const correct = results.filter(result => result.correct).length
      toast(`Matching quiz recorded: ${correct} of ${results.length} correct`)
      await load()
      return true
    } catch {
      toast('Could not record matching answers')
      return false
    } finally {
      setQuestionMutating(false)
    }
  }

  async function remove() {
    if (menuActionBusy) return
    if (!confirm('Delete this card?')) return
    setMenuActionBusy(true)
    try {
      const res = await fetch(`/api/cards/${id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => null)
      if (res.ok && isOkResponse(d)) {
        toast('Card deleted')
        router.push('/items')
      } else {
        toast(apiError(d, res.ok ? 'The local delete API returned an unexpected response' : 'Could not delete card'))
        setMenuActionBusy(false)
        load()
      }
    } catch {
      toast('Could not delete card')
      setMenuActionBusy(false)
      load()
    }
  }

  async function copyCardLink() {
    const href = new URL(`/item/${id}`, window.location.origin).toString()
    await copyToClipboard(href, 'Card link copied', 'Could not copy card link')
    setMenuOpen(false)
  }

  async function shareCard() {
    if (menuActionBusy) return
    setMenuActionBusy(true)
    setMenuOpen(false)
    try {
      const res = await fetch(`/api/cards/${id}/share`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (res.ok && isOkResponse(d) && 'shareId' in d && typeof d.shareId === 'string') {
        const href = new URL(`/share/${d.shareId}`, window.location.origin).toString()
        await copyToClipboard(href, 'Share link copied', 'Card shared, but the link could not be copied')
      } else {
        toast(apiError(d, res.ok ? 'The local share API returned an unexpected response' : 'Could not share card'))
      }
    } catch {
      toast('Could not share card')
    } finally {
      setMenuActionBusy(false)
      load()
    }
  }

  async function copyShareLink() {
    if (!card?.shareId) return
    const href = new URL(`/share/${card.shareId}`, window.location.origin).toString()
    await copyToClipboard(href, 'Share link copied', 'Could not copy share link')
    setMenuOpen(false)
  }

  async function unshareCard() {
    if (menuActionBusy) return
    setMenuOpen(false)
    if (!confirm('Stop sharing this card? The public link will stop working.')) return
    setMenuActionBusy(true)
    try {
      const res = await fetch(`/api/cards/${id}/share`, { method: 'DELETE' })
      const d = await res.json().catch(() => null)
      toast(res.ok && isOkResponse(d) ? 'Sharing stopped' : apiError(d, res.ok ? 'The local share API returned an unexpected response' : 'Could not stop sharing'))
    } catch {
      toast('Could not stop sharing')
    } finally {
      setMenuActionBusy(false)
      load()
    }
  }

  async function exportMarkdown() {
    setExportingMarkdown(true)
    try {
      const res = await fetch(`/api/cards/${id}/markdown`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d.error || 'Could not export Markdown')
        return
      }
      const markdown = await res.text()
      const filename = filenameFromContentDisposition(res.headers.get('Content-Disposition')) ?? 'recall-card.md'
      downloadTextFile(markdown, filename)
      setMenuOpen(false)
      toast('Markdown exported')
    } catch {
      toast('Could not export Markdown')
    } finally {
      setExportingMarkdown(false)
    }
  }

  function changeReadingSize(direction: -1 | 1) {
    const current = READING_SIZES.findIndex(size => size.id === readingSize)
    const next = READING_SIZES[Math.min(READING_SIZES.length - 1, Math.max(0, current + direction))]
    setReadingSize(next.id)
    writeReadingSize(next.id)
  }

  function focusTab(next: Tab) {
    setTab(next)
    window.setTimeout(() => document.getElementById(cardTabId(next))?.focus(), 0)
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: Tab) {
    const currentIndex = TABS.findIndex(item => item.id === current)
    if (currentIndex < 0) return

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusTab(TABS[(currentIndex + 1) % TABS.length].id)
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusTab(TABS[(currentIndex - 1 + TABS.length) % TABS.length].id)
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusTab(TABS[0].id)
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusTab(TABS[TABS.length - 1].id)
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="font-display" style={{ fontSize: '1.6rem' }}>This card is gone.</h1>
        <p className="rr-prose mt-2">It may have been deleted.</p>
        <Link href="/items" className="rr-btn mt-5 inline-block">← Back to library</Link>
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="font-display" style={{ fontSize: '1.6rem' }}>Could not open this card.</h1>
        <p className="rr-prose mt-2">{loadError}</p>
        <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <button className="rr-btn rr-btn-accent" onClick={load}>Try again</button>
          <Link href="/items" className="rr-btn">Back to library</Link>
        </div>
      </div>
    )
  }
  if (!card) return <div className="mx-auto max-w-3xl px-6 py-16 rr-mono">opening card…</div>

  const processing = card.status === 'organizing' || card.status === 'summarizing'
  const canRetry = !!card.url && card.sourceType !== 'document' && card.sourceType !== 'image' && (card.status === 'failed' || !card.readerContent)
  const currentReadingSize = READING_SIZES.find(size => size.id === readingSize) ?? READING_SIZES[1]
  const readingStyle = { fontSize: `${currentReadingSize.scale}rem` }

  return (
    <div className="mx-auto max-w-3xl px-6 md:px-10 pb-24">
      {/* top bar */}
      <div className="flex items-center justify-between pt-8 pb-4">
        <Link href="/items" className="rr-mono rr-link">← Library</Link>
        <div className="flex items-center gap-3">
          <div className="rr-card flex items-center gap-1 px-2 py-1" style={{ borderRadius: 3 }}>
            <Type size={14} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.8 }} />
            <button
              className="rr-btn-plain"
              onClick={() => changeReadingSize(-1)}
              disabled={readingSize === 'compact'}
              aria-label="Decrease reading text size"
              title="Decrease reading text size"
            >
              <Minus size={13} aria-hidden="true" />
            </button>
            <span className="rr-mono min-w-9 text-center">{currentReadingSize.label}</span>
            <button
              className="rr-btn-plain"
              onClick={() => changeReadingSize(1)}
              disabled={readingSize === 'wide'}
              aria-label="Increase reading text size"
              title="Increase reading text size"
            >
              <Plus size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="relative" ref={menuRef}>
            <button
              ref={menuButtonRef}
              className="rr-mono rr-btn-plain"
              onClick={() => setMenuOpen(v => !v)}
              aria-label="More actions"
              aria-haspopup="menu"
              aria-controls={menuOpen ? 'card-actions-menu' : undefined}
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
              more
            </button>
          {menuOpen && (
            <div
              id="card-actions-menu"
              className="rr-card absolute right-0 mt-2 w-60 py-1 z-20"
              role="menu"
              aria-label="Card actions"
              onKeyDown={onMenuKeyDown}
              style={{ borderRadius: 3 }}
            >
              <div className="px-4 py-2 rr-rule" role="presentation">
                <div className="flex items-center justify-between gap-3">
                  <span className="rr-mono" style={{ fontSize: '0.62rem' }}>Updated</span>
                  <span className="rr-prose text-right" style={{ fontSize: '0.86rem' }} title={formatDate(card.updatedAt)}>{relativeTime(card.updatedAt)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="rr-mono" style={{ fontSize: '0.62rem' }}>Created</span>
                  <span className="rr-prose text-right" style={{ fontSize: '0.86rem' }} title={formatDate(card.createdAt)}>{relativeTime(card.createdAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={exportMarkdown}
                disabled={exportingMarkdown}
                className="block w-full text-left px-4 py-2 rr-prose"
                role="menuitem"
                data-card-menu-item
                style={{ fontSize: '0.9rem' }}
              >
                {exportingMarkdown ? 'Exporting…' : 'Export to Markdown'}
              </button>
              <button disabled className="block w-full text-left px-4 py-2 rr-prose" role="menuitem" aria-disabled="true" aria-label="Open card image gallery (planned)" title="Card image galleries are planned after richer media capture and export behavior exist." style={{ fontSize: '0.9rem', color: 'var(--sepia-2)', cursor: 'not-allowed' }}>Images ·</button>
              <button onClick={copyCardLink} className="block w-full text-left px-4 py-2 rr-prose" role="menuitem" data-card-menu-item style={{ fontSize: '0.9rem' }}>Copy local link</button>
              {card.shared ? (
                <>
                  <button onClick={copyShareLink} className="block w-full text-left px-4 py-2 rr-prose" role="menuitem" data-card-menu-item aria-label="Copy public share link" title="Copy the read-only public share link." style={{ fontSize: '0.9rem' }}>Copy share link</button>
                  <button onClick={unshareCard} disabled={menuActionBusy} className="block w-full text-left px-4 py-2 rr-prose" role="menuitem" data-card-menu-item aria-label="Stop sharing this card" title="Revoke the public share link." style={{ fontSize: '0.9rem' }}>{menuActionBusy ? 'Working…' : 'Make private'}</button>
                </>
              ) : (
                <button onClick={shareCard} disabled={menuActionBusy} className="block w-full text-left px-4 py-2 rr-prose" role="menuitem" data-card-menu-item aria-label="Create a read-only public share link" title="Create a read-only public share link and copy it." style={{ fontSize: '0.9rem' }}>{menuActionBusy ? 'Working…' : 'Share card'}</button>
              )}
              {card.url && <a href={card.url} onClick={() => setMenuOpen(false)} target="_blank" rel="noreferrer" className="block px-4 py-2 rr-prose" role="menuitem" data-card-menu-item style={{ fontSize: '0.9rem' }}>Open source ↗</a>}
              <button onClick={remove} disabled={menuActionBusy} className="block w-full text-left px-4 py-2 rr-prose" role="menuitem" data-card-menu-item style={{ fontSize: '0.9rem', color: 'var(--accent)' }}>{menuActionBusy ? 'Working…' : 'Delete card'}</button>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* title */}
      {editingTitle ? (
        <input
          autoFocus
          aria-label="Card title"
          value={titleDraft}
          onChange={e => setTitleDraft(e.target.value)}
          onBlur={() => { setEditingTitle(false); if (titleDraft.trim() && titleDraft !== card.title) patch({ title: titleDraft.trim() }, 'Title saved') }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="w-full bg-transparent outline-none font-display"
          style={{ fontSize: '2.2rem', fontWeight: 500, lineHeight: 1.15, overflowWrap: 'anywhere' }}
        />
      ) : (
        <h1 onClick={() => setEditingTitle(true)} className="font-display cursor-text" style={{ fontSize: '2.2rem', fontWeight: 500, lineHeight: 1.15, overflowWrap: 'anywhere' }} title="Click to edit">
          {card.title}
        </h1>
      )}

      {/* meta */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {card.url
          ? <a href={card.url} target="_blank" rel="noreferrer" className="rr-mono rr-link" style={{ color: 'var(--accent)', overflowWrap: 'anywhere' }}>{card.provider ?? 'source'} ↗</a>
          : <span className="rr-mono" style={{ overflowWrap: 'anywhere' }}>{card.provider ?? card.sourceType}</span>}
        <span
          className="rr-tag"
          title={card.shared ? 'This card has a read-only public share link. Use the ⋯ menu to copy it or make the card private.' : 'This card is private. Use the ⋯ menu to create a read-only share link.'}
          style={card.shared ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
        >
          {card.shared ? 'Shared' : 'Private · local'}
        </span>
        {card.readTime && <span className="rr-mono">{card.readTime} min read</span>}
        {processing && !processingStalled && <span className="rr-mono" style={{ color: 'var(--gold)' }}>● {card.status}…</span>}
        {processing && processingStalled && (
          <span className="rr-mono" style={{ color: 'var(--warning, #f59e0b)' }}>
            ⚠ still {card.status} — taking longer than expected.{' '}
            <button
              className="rr-link"
              style={{ color: 'var(--accent)' }}
              onClick={() => { processingStartRef.current = null; setProcessingStalled(false); load() }}
            >
              ↻ check again
            </button>
            {canRetry && <> · <button className="rr-link" style={{ color: 'var(--accent)' }} onClick={retry} disabled={retrying}>{retrying ? 'retrying…' : 'retry extraction'}</button></>}
          </span>
        )}
        {canRetry && !processing && (
          <button className="rr-mono rr-link" style={{ color: 'var(--accent)' }} onClick={retry} disabled={retrying}>
            {retrying ? 'retrying…' : '↻ retry extraction'}
          </button>
        )}
      </div>

      {card.sourceType === 'image' && card.thumbnail && (
        <a
          href={card.thumbnail}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open full image for ${card.title}`}
          className="rr-card mt-5 block overflow-hidden"
          style={{ borderRadius: 3 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.thumbnail}
            alt=""
            className="max-h-[520px] w-full object-contain"
            style={{ background: 'var(--paper)' }}
          />
        </a>
      )}

      {/* tags — editable */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {card.categories.map(t => (
          <span key={t.slug} className="rr-tag group inline-flex items-center gap-1" style={{ borderColor: t.color, color: t.color }}>
            {t.name}
            <button
              onClick={() => removeTag(t.slug)}
              disabled={tagMutating}
              aria-label={`Remove tag ${t.name}`}
              className="opacity-50 hover:opacity-100 disabled:cursor-not-allowed"
              style={{ fontSize: '0.8em' }}
            >×</button>
          </span>
        ))}
        {card.semanticTags.slice(0, 8).map(t => <span key={t} className="rr-tag">{t}</span>)}
        {addingTag ? (
          <input
            autoFocus
            aria-label="Tag name"
            value={tagDraft}
            onChange={e => setTagDraft(e.target.value)}
            onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); else setAddingTag(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addTag(tagDraft) }
              if (e.key === 'Escape') { setTagDraft(''); setAddingTag(false) }
            }}
            placeholder="tag name"
            className="rr-tag bg-transparent outline-none"
            disabled={tagMutating}
            style={{ minWidth: 90 }}
          />
        ) : (
          <button
            className="rr-tag disabled:cursor-not-allowed"
            onClick={() => setAddingTag(true)}
            disabled={tagMutating}
            aria-label="Add tag"
            style={{ borderStyle: 'dashed' }}
          >＋ tag</button>
        )}
      </div>

      {/* tabs */}
      <div className="mt-7 flex gap-5 rr-rule pb-0 overflow-x-auto" role="tablist" aria-label="Card sections">
        {TABS.map(t => (
          <button
            key={t.id}
            id={cardTabId(t.id)}
            type="button"
            role="tab"
            onClick={() => setTab(t.id)}
            onKeyDown={e => onTabKeyDown(e, t.id)}
            className="rr-mono pb-2 shrink-0"
            aria-selected={tab === t.id}
            aria-controls={cardPanelId(t.id)}
            aria-label={t.planned ? `${t.label} tab (${t.plannedPhase} planned)` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            style={{
              color: tab === t.id ? 'var(--accent)' : t.planned ? 'var(--sepia-2)' : 'var(--sepia)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              opacity: t.planned && tab !== t.id ? 0.72 : 1,
              cursor: 'pointer',
            }}
            title={t.plannedTitle}
          >
            {t.label}{t.planned && ' ·'}
          </button>
        ))}
      </div>

      {/* panels */}
      <div id={cardPanelId(tab)} role="tabpanel" aria-labelledby={cardTabId(tab)} className="pt-6">
        {tab === 'notebook' && (
          <NotebookPanel
            cardId={card.id}
            content={card.notebookContent}
            readingStyle={readingStyle}
            processing={processing}
            editing={editingNotebook}
            draft={notebookDraft}
            regenerating={regenerating}
            setDraft={setNotebookDraft}
            onEdit={() => setEditingNotebook(true)}
            onCancel={() => { setEditingNotebook(false); setNotebookDraft(card.notebookContent) }}
            onSave={() => { setEditingNotebook(false); patch({ notebookContent: notebookDraft }, 'Notebook saved') }}
            onCopy={() => copyToClipboard(card.notebookContent, 'Notebook copied', 'Could not copy Notebook')}
            onRegenerate={regenerate}
          />
        )}
        {tab === 'reader' && <ReaderPanel cardId={card.id} sourceType={card.sourceType} content={card.readerContent} readingStyle={readingStyle} canRetry={canRetry} retrying={retrying} onRetry={retry} />}
        {tab === 'chat' && <CardChatPanel card={card} />}
        {tab === 'quiz' && (
          <QuizPanel
            card={card}
            autoStart={initialQuizStart}
            generatingQuestions={generatingQuestions}
            questionMutating={questionMutating}
            onGenerateQuestions={generateQuestions}
            onCreateManualQuestion={createManualQuestion}
            onUpdateQuestion={updateQuestion}
            onDeleteQuestion={deleteQuestion}
            onReviewQuestion={reviewQuestion}
            onReviewQuestions={reviewQuestions}
          />
        )}
        {tab === 'connections' && (
          <ConnectionsPanel
            card={card}
            relatedCards={relatedCards}
            relatedLoading={relatedLoading}
            relatedError={relatedError}
            manualLinkDraft={manualLinkDraft}
            connectionMutating={connectionMutating}
            setManualLinkDraft={setManualLinkDraft}
            onCreateManualConnection={createManualConnection}
            onRemoveConnection={removeConnection}
            onGenerateConnections={generateConnections}
            onRetryRelated={loadRelated}
            generatingConnections={generatingConnections}
          />
        )}
        {tab === 'graph' && (
          <GraphPanel
            card={card}
            relatedCards={relatedCards}
            relatedLoading={relatedLoading}
            relatedError={relatedError}
            onRetryRelated={loadRelated}
          />
        )}
      </div>
    </div>
  )
}

function cardTabId(tab: Tab): string {
  return `card-detail-tab-${tab}`
}

function cardPanelId(tab: Tab): string {
  return `card-detail-panel-${tab}`
}

function parseInitialTab(value: string | undefined): Tab {
  return TABS.some(tab => tab.id === value) ? value as Tab : 'notebook'
}

function menuItems(root: HTMLDivElement | null): HTMLElement[] {
  return root
    ? Array.from(root.querySelectorAll<HTMLElement>('[data-card-menu-item]:not([disabled])'))
    : []
}

function focusFirstMenuItem(root: HTMLDivElement | null) {
  menuItems(root)[0]?.focus()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

async function copyToClipboard(text: string, success: string, failure: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(text)
    toast(success)
  } catch {
    toast(failure)
  }
}

function downloadTextFile(text: string, filename: string) {
  const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(blobUrl)
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? null
}

function isOkResponse(data: unknown): data is { ok: true } {
  return data !== null && typeof data === 'object' && 'ok' in data && data.ok === true
}

function isGeneratedConnectionsResponse(data: unknown): data is { ok: true; created: number } {
  return isOkResponse(data) && 'created' in data && typeof data.created === 'number'
}

function isGeneratedQuestionsResponse(data: unknown): data is { ok: true; created: number; total: number } {
  return isOkResponse(data) &&
    'created' in data &&
    typeof data.created === 'number' &&
    'total' in data &&
    typeof data.total === 'number'
}

function isQuestionMutationResponse(data: unknown): data is { ok: true; question: CardQuizQuestion; total: number } {
  return isOkResponse(data) &&
    'question' in data &&
    isQuestionLike((data as { question?: unknown }).question) &&
    'total' in data &&
    typeof data.total === 'number'
}

function isCreatedQuestionResponse(data: unknown): data is { ok: true; question: CardQuizQuestion; total: number } {
  return isQuestionMutationResponse(data)
}

function isDeletedQuestionResponse(data: unknown): data is { ok: true; total: number } {
  return isOkResponse(data) &&
    'total' in data &&
    typeof data.total === 'number'
}

function isReviewedQuestionResponse(data: unknown): data is { ok: true; question: CardQuizQuestion } {
  return isOkResponse(data) &&
    'question' in data &&
    isQuestionLike((data as { question?: unknown }).question)
}

function isQuestionLike(value: unknown): value is CardQuizQuestion {
  if (value === null || typeof value !== 'object') return false
  const question = value as Record<string, unknown>
  return typeof question.id === 'string' &&
    typeof question.prompt === 'string' &&
    typeof question.answer === 'string' &&
    typeof question.type === 'string' &&
    (!('options' in question) || Array.isArray(question.options) && question.options.every(option => typeof option === 'string')) &&
    typeof question.origin === 'string' &&
    typeof question.memoryStage === 'string' &&
    typeof question.timesSeen === 'number' &&
    typeof question.timesCorrect === 'number'
}

function isGraphResponse(data: unknown): data is { graph: CardGraph } {
  if (data === null || typeof data !== 'object' || !('graph' in data)) return false
  const graph = (data as { graph?: unknown }).graph
  return graph !== null && typeof graph === 'object' &&
    'cards' in graph && Array.isArray((graph as { cards?: unknown }).cards) &&
    'entities' in graph && Array.isArray((graph as { entities?: unknown }).entities) &&
    'edges' in graph && Array.isArray((graph as { edges?: unknown }).edges)
}

function isChatAnswerResponse(data: unknown): data is { ok: true } & ChatAnswer {
  if (!isOkResponse(data) || !('threadId' in data) || !('answer' in data) || !('citations' in data)) return false
  return typeof data.threadId === 'string' &&
    typeof data.answer === 'string' &&
    Array.isArray(data.citations)
}

function apiError(data: unknown, fallback: string): string {
  if (data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error
  }
  return fallback
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null)
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error
  }
  return fallback
}

function NotebookPanel(props: {
  cardId: string; content: string; readingStyle: CSSProperties; processing: boolean; editing: boolean; draft: string; regenerating: boolean
  setDraft: (s: string) => void; onEdit: () => void; onCancel: () => void; onSave: () => void
  onCopy: () => void; onRegenerate: () => void
}) {
  if (props.processing && !props.content) {
    return <p className="rr-prose" style={{ opacity: 0.8 }}>The local model is reading and summarizing this — the notebook will appear shortly.</p>
  }
  if (!props.content && !props.editing) {
    return (
      <div>
        <p className="rr-prose" style={{ opacity: 0.8 }}>No notebook yet.</p>
        <div className="mt-3 flex gap-3">
          <button className="rr-btn" onClick={props.onEdit}>Write one</button>
          <button className="rr-btn" onClick={props.onRegenerate} disabled={props.regenerating}>{props.regenerating ? 'Generating…' : '↻ Generate with AI'}</button>
        </div>
      </div>
    )
  }
  if (props.editing) {
    return (
      <div>
        <textarea
          aria-label="Notebook content"
          value={props.draft}
          onChange={e => props.setDraft(e.target.value)}
          rows={18}
          className="w-full bg-transparent outline-none rr-prose p-3"
          style={{ border: '1px solid var(--hairline)', borderRadius: 3, fontFamily: 'var(--font-mono)', fontSize: `${props.readingStyle.fontSize}` }}
        />
        <div className="mt-3 flex gap-3">
          <button className="rr-btn rr-btn-accent" onClick={props.onSave}>Save notebook</button>
          <button className="rr-btn" onClick={props.onCancel}>Cancel</button>
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="flex justify-end gap-3 mb-2">
        <ListenButton cardId={props.cardId} />
        <button className="rr-mono rr-link" onClick={props.onCopy}>copy</button>
        <button className="rr-mono rr-link" onClick={props.onEdit}>edit</button>
        <button className="rr-mono rr-link" onClick={props.onRegenerate} disabled={props.regenerating}>{props.regenerating ? 'regenerating…' : '↻ regenerate'}</button>
      </div>
      <NotebookContents content={props.content} />
      <div className="rr-prose" style={props.readingStyle} dangerouslySetInnerHTML={{ __html: renderMarkdown(props.content) }} />
    </div>
  )
}

// Synthesize + play a spoken audio summary of the card via the local TTS route.
function ListenButton({ cardId }: { cardId: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  const cleanup = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
  }, [])

  useEffect(() => cleanup, [cleanup])

  async function listen() {
    if (status === 'playing') { cleanup(); setStatus('idle'); return }
    if (status === 'loading') return
    setStatus('loading')
    try {
      const res = await fetch(`/api/cards/${cardId}/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: readTtsVoice() }),
      })
      if (!res.ok) throw new Error(await readApiError(res, 'Could not generate audio summary'))
      const blob = await res.blob()
      cleanup()
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { cleanup(); setStatus('idle') }
      audio.onerror = () => { cleanup(); setStatus('idle'); toast('Could not play audio summary') }
      await audio.play()
      setStatus('playing')
    } catch (err) {
      cleanup()
      setStatus('idle')
      toast(errorMessage(err, 'Could not generate audio summary'))
    }
  }

  return (
    <button
      className="rr-mono rr-link"
      onClick={() => void listen()}
      disabled={status === 'loading'}
      aria-live="polite"
      aria-label={status === 'loading' ? 'Synthesizing audio summary' : status === 'playing' ? 'Stop audio summary' : 'Listen to audio summary'}
      title="Listen to a spoken summary (local TTS)"
    >
      {status === 'loading' ? 'synthesizing…' : status === 'playing' ? '◼ stop' : '▶ listen'}
    </button>
  )
}

function NotebookContents({ content }: { content: string }) {
  const headings = markdownHeadings(content).filter(h => h.level <= 3)
  if (headings.length < 2) return null

  return (
    <nav
      className="rr-card mb-5 px-4 py-3"
      aria-label="Notebook contents"
      style={{ borderRadius: 3 }}
    >
      <div className="rr-mono mb-2" style={{ color: 'var(--accent)' }}>Contents</div>
      <ol className="space-y-1">
        {headings.map(h => (
          <li key={h.id} style={{ paddingLeft: `${Math.max(0, h.level - 1) * 0.75}rem` }}>
            <a className="rr-link rr-prose" style={{ fontSize: '0.92rem', overflowWrap: 'anywhere' }} href={`#${h.id}`}>
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function ReaderPanel({
  cardId,
  sourceType,
  content,
  readingStyle,
  canRetry,
  retrying,
  onRetry,
}: {
  cardId: string
  sourceType: string
  content: string
  readingStyle: CSSProperties
  canRetry: boolean
  retrying: boolean
  onRetry: () => void
}) {
  const [reformatting, setReformatting] = useState(false)
  const [reformatError, setReformatError] = useState<string | null>(null)
  const [reformatted, setReformatted] = useState<string | null>(null)
  const [readerMode, setReaderMode] = useState<ReaderMode>('original')

  function focusReaderMode(next: ReaderMode) {
    setReaderMode(next)
    window.setTimeout(() => document.getElementById(readerModeTabId(next))?.focus(), 0)
  }

  function onReaderModeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, current: ReaderMode) {
    const availableModes: ReaderMode[] = reformatted ? ['original', 'reformatted'] : ['original']
    const index = availableModes.indexOf(current)
    if (index < 0) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusReaderMode(availableModes[(index + 1) % availableModes.length])
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusReaderMode(availableModes[(index - 1 + availableModes.length) % availableModes.length])
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusReaderMode(availableModes[0])
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusReaderMode(availableModes[availableModes.length - 1])
    }
  }

  async function reformatReader() {
    if (reformatting) return
    setReformatting(true)
    setReformatError(null)
    try {
      const res = await fetch(`/api/cards/${encodeURIComponent(cardId)}/reader/reformat`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiError(data, 'Could not reformat Reader text'))
      if (!isReaderReformatResponse(data)) throw new Error('The Reader reformat API returned an unexpected response')
      setReformatted(data.reformatted)
      setReaderMode('reformatted')
      if (data.truncated) {
        setReformatError('Reader reformat used the first local processing window; the original text is still available.')
      }
    } catch (err) {
      setReformatError(err instanceof Error ? err.message : 'Could not reformat Reader text')
    } finally {
      setReformatting(false)
    }
  }

  const activeReaderContent = readerMode === 'reformatted' && reformatted ? reformatted : content

  if (!content) {
    return (
      <div>
        <p className="rr-prose" style={{ opacity: 0.8 }}>
          {sourceType === 'media'
            ? 'No transcript or reader text is saved for this media page yet. Open the source link for playback, or retry extraction if captions or local transcription are available.'
            : 'No reader content was extracted for this card.'}
        </p>
        {canRetry && <button className="rr-btn mt-3" onClick={onRetry} disabled={retrying}>{retrying ? 'Retrying…' : '↻ Retry extraction'}</button>}
      </div>
    )
  }
  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2" role="tablist" aria-label="Reader format">
          <button
            id={readerModeTabId('original')}
            className="rr-tag"
            role="tab"
            aria-selected={readerMode === 'original'}
            aria-controls="reader-original-panel"
            tabIndex={readerMode === 'original' ? 0 : -1}
            type="button"
            onClick={() => setReaderMode('original')}
            onKeyDown={event => onReaderModeKeyDown(event, 'original')}
            style={readerMode === 'original' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            Original
          </button>
          <button
            id={readerModeTabId('reformatted')}
            className="rr-tag"
            role="tab"
            aria-selected={readerMode === 'reformatted'}
            aria-controls="reader-reformatted-panel"
            tabIndex={readerMode === 'reformatted' ? 0 : -1}
            type="button"
            disabled={!reformatted}
            onClick={() => setReaderMode('reformatted')}
            onKeyDown={event => onReaderModeKeyDown(event, 'reformatted')}
            title={reformatted ? 'Show the local Reader reformat.' : 'Run reformat first.'}
            style={readerMode === 'reformatted' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            Reformatted
          </button>
        </div>
        <div className="flex justify-end gap-3">
          <button className="rr-mono rr-link" onClick={() => copyToClipboard(activeReaderContent, 'Reader copied', 'Could not copy Reader')}>copy</button>
          <button
            className="rr-mono rr-link"
            aria-label="Reformat Reader text with the local model"
            title="Reformat the extracted Reader text into readable Markdown without overwriting the original."
            disabled={reformatting}
            onClick={() => void reformatReader()}
            type="button"
          >
            {reformatting ? 'reformatting…' : 'reformat'}
          </button>
        </div>
      </div>
      {reformatError && (
        <div className="rr-card mb-4 p-3" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.92rem' }}>{reformatError}</p>
        </div>
      )}
      {readerMode === 'reformatted' && reformatted ? (
        <div
          id="reader-reformatted-panel"
          role="tabpanel"
          aria-labelledby={readerModeTabId('reformatted')}
          aria-label="Reformatted Reader text"
          className="rr-prose"
          style={readingStyle}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(reformatted) }}
        />
      ) : (
        <div
          id="reader-original-panel"
          role="tabpanel"
          aria-labelledby={readerModeTabId('original')}
          aria-label="Original Reader text"
          className="rr-prose rr-dropcap"
          style={readingStyle}
          dangerouslySetInnerHTML={{ __html: renderReader(content) }}
        />
      )}
    </div>
  )
}

function isReaderReformatResponse(data: unknown): data is { ok: true; reformatted: string; truncated?: boolean } {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true && typeof record.reformatted === 'string'
}

function readerModeTabId(mode: ReaderMode): string {
  return `reader-format-tab-${mode}`
}

type CardChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: ChatCitation[]
  warning?: string
}

function CardChatPanel({ card }: { card: CardDetail }) {
  const [prompt, setPrompt] = useState('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<CardChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [includeSemantic, setIncludeSemantic] = useState(true)
  const [attachments, setAttachments] = useState<ChatAttachmentDraft[]>([])
  const canSend = prompt.trim().length > 0 && !sending

  async function sendChat(nextPrompt = prompt) {
    const trimmed = nextPrompt.trim()
    if (!trimmed || sending) return
    const userMessage: CardChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
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
          scope: 'card',
          cardIds: [card.id],
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
          warning: data.warning,
        },
      ])
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Could not answer from local knowledge')
      setPrompt(trimmed)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="rr-mono" style={{ color: 'var(--accent)' }}>Card chat · Phase 2</p>
        <h2 className="font-display mt-1" style={{ fontSize: '1.25rem', fontWeight: 500 }}>Chat with this card</h2>
      </div>
      <div className="rr-card p-4" style={{ borderRadius: 3 }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rr-mono">Context</span>
          <span className="rr-tag" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>Current card</span>
          <label className="rr-tag inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeSemantic}
              onChange={event => setIncludeSemantic(event.currentTarget.checked)}
              className="accent-[var(--accent)]"
            />
            Semantic library context
          </label>
          <span className="rr-prose" style={{ fontSize: '0.92rem', overflowWrap: 'anywhere' }}>{card.title}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="rr-btn" onClick={() => void sendChat('Give me a concise summary of this card with citations.')} disabled={sending} type="button">Concise summary</button>
          <button className="rr-btn" onClick={() => void sendChat('Give me a detailed summary of this card, including key claims and caveats, with citations.')} disabled={sending} type="button">Detailed summary</button>
        </div>
      </div>
      {messages.length > 0 && (
        <div className="space-y-4" aria-live="polite">
          {messages.map(message => (
            <div key={message.id} className="rr-card p-4" style={{ borderRadius: 3 }}>
              <p className="rr-mono" style={{ color: message.role === 'assistant' ? 'var(--accent)' : 'var(--sepia)' }}>
                {message.role === 'assistant' ? 'Recall' : 'You'}
              </p>
              <p className="rr-prose mt-2 whitespace-pre-wrap" style={{ fontSize: '0.95rem' }}>{message.content}</p>
              {message.warning && <p className="rr-mono mt-3" style={{ color: 'var(--gold)' }}>{message.warning}</p>}
              {message.citations && message.citations.length > 0 && (
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
          ))}
        </div>
      )}
      {chatError && (
        <div className="rr-card p-4" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.94rem' }}>{chatError}</p>
        </div>
      )}
      <form
        onSubmit={event => {
          event.preventDefault()
          void sendChat()
        }}
      >
        <label className="block">
          <span className="sr-only">Card chat prompt</span>
          <textarea
            rows={4}
            value={prompt}
            onChange={event => setPrompt(event.currentTarget.value)}
            placeholder="What would you like to know?"
            className="w-full bg-transparent p-3 outline-none rr-prose"
            style={{ border: '1px solid var(--hairline)', borderRadius: 3, resize: 'vertical' }}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void sendChat()
              }
            }}
          />
        </label>
      </form>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button className="rr-btn rr-btn-icon" disabled aria-label="Choose additional card chat context (planned)" title="Custom tag/card context picking is planned after the shared chat context picker is writable from the composer."><AtSign size={14} aria-hidden="true" /><span>Context</span></button>
          <ChatAttachmentControl
            attachments={attachments}
            disabled={sending}
            onAdd={drafts => setAttachments(current => [...current, ...drafts])}
            onRemove={id => setAttachments(current => current.filter(attachment => attachment.id !== id))}
            label="Upload temporary card chat context"
          />
          <span className="rr-tag">Auto · local</span>
        </div>
        <button className="rr-btn rr-btn-accent rr-btn-icon" disabled={!canSend} onClick={() => void sendChat()} type="button" aria-label="Send card chat prompt" title="Ask the local model using this card and selected semantic Recall context."><MessageCircle size={14} aria-hidden="true" /><span>{sending ? 'Answering…' : 'Send'}</span></button>
      </div>
      <p className="rr-prose" style={{ fontSize: '0.9rem' }}>
        Answers use local Recall context and cite saved cards. Uploaded text, Markdown, CSV, JSON, code files, extractable PDFs, and PNG/JPG/WebP images are temporary context for this browser session; custom context picking and chat history browsing are still planned here.
      </p>
    </div>
  )
}

function QuizPanel({
  card,
  autoStart,
  generatingQuestions,
  questionMutating,
  onGenerateQuestions,
  onCreateManualQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onReviewQuestion,
  onReviewQuestions,
}: {
  card: CardDetail
  autoStart: boolean
  generatingQuestions: boolean
  questionMutating: boolean
  onGenerateQuestions: () => void
  onCreateManualQuestion: (input: { prompt: string; answer: string }) => Promise<boolean>
  onUpdateQuestion: (questionId: string, input: { prompt: string; answer: string }) => Promise<boolean>
  onDeleteQuestion: (questionId: string) => Promise<boolean>
  onReviewQuestion: (questionId: string, correct: boolean) => Promise<boolean>
  onReviewQuestions: (results: { questionId: string; correct: boolean }[]) => Promise<boolean>
}) {
  const [creatingCustom, setCreatingCustom] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [customAnswer, setCustomAnswer] = useState('')
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [editAnswer, setEditAnswer] = useState('')
  const [sessionActive, setSessionActive] = useState(() => autoStart && card.quizQuestions.length > 0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answerRevealed, setAnswerRevealed] = useState(false)
  const [userAnswer, setUserAnswer] = useState('')
  const [selectedOption, setSelectedOption] = useState('')
  const [timedMode, setTimedMode] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(TIMED_QUIZ_SECONDS)
  const [timedOutQuestionId, setTimedOutQuestionId] = useState<string | null>(null)
  const [matchingActive, setMatchingActive] = useState(false)
  const [matchingAnswers, setMatchingAnswers] = useState<CardQuizQuestion[]>([])
  const [matchingSelections, setMatchingSelections] = useState<Record<string, string>>({})
  const [matchingScore, setMatchingScore] = useState<{ correct: number; total: number } | null>(null)
  const quizQuestions = sortedQuizQuestions(card.quizQuestions)
  const activeIndex = Math.min(currentIndex, Math.max(0, quizQuestions.length - 1))
  const currentQuestion = quizQuestions[activeIndex] ?? null
  const currentOptions = questionOptions(currentQuestion)
  const currentIsMcq = currentOptions.length > 0
  const canStartMatching = quizQuestions.length >= 2
  const canSubmitMatching = matchingActive && quizQuestions.every(question => matchingSelections[question.id]) && !questionMutating && !matchingScore
  const canSaveCustom = customPrompt.trim().length > 0 && customAnswer.trim().length > 0 && !questionMutating
  const canSaveEdit = editPrompt.trim().length > 0 && editAnswer.trim().length > 0 && !questionMutating

  async function submitCustomQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSaveCustom) return
    const saved = await onCreateManualQuestion({ prompt: customPrompt, answer: customAnswer })
    if (!saved) return
    setCustomPrompt('')
    setCustomAnswer('')
    setCreatingCustom(false)
  }

  async function submitQuestionEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingQuestionId || !canSaveEdit) return
    const saved = await onUpdateQuestion(editingQuestionId, { prompt: editPrompt, answer: editAnswer })
    if (!saved) return
    cancelQuestionEdit()
  }

  function startQuestionEdit(question: CardQuizQuestion) {
    setEditingQuestionId(question.id)
    setEditPrompt(question.prompt)
    setEditAnswer(question.answer)
  }

  function cancelQuestionEdit() {
    setEditingQuestionId(null)
    setEditPrompt('')
    setEditAnswer('')
  }

  async function deleteQuestion(questionId: string) {
    const deleted = await onDeleteQuestion(questionId)
    if (!deleted) return
    if (editingQuestionId === questionId) cancelQuestionEdit()
    if (currentQuestion?.id === questionId) {
      setSessionActive(false)
      setTimedMode(false)
      setTimedOutQuestionId(null)
      setAnswerRevealed(false)
      setUserAnswer('')
      setSelectedOption('')
    }
    if (matchingActive && (matchingAnswers.some(question => question.id === questionId) || matchingSelections[questionId])) {
      endMatchingQuiz()
    }
  }

  function endQuiz() {
    setSessionActive(false)
    setTimedMode(false)
    setTimedOutQuestionId(null)
  }

  function startQuiz(timed = false) {
    if (quizQuestions.length === 0) return
    setMatchingActive(false)
    setMatchingScore(null)
    setSessionActive(true)
    setTimedMode(timed)
    setSecondsLeft(TIMED_QUIZ_SECONDS)
    setTimedOutQuestionId(null)
    setCurrentIndex(0)
    setAnswerRevealed(false)
    setUserAnswer('')
    setSelectedOption('')
  }

  function startMatchingQuiz() {
    if (!canStartMatching) return
    setSessionActive(false)
    setTimedMode(false)
    setTimedOutQuestionId(null)
    setMatchingActive(true)
    setMatchingAnswers(shuffleQuizQuestions(quizQuestions))
    setMatchingSelections({})
    setMatchingScore(null)
  }

  function endMatchingQuiz() {
    setMatchingActive(false)
    setMatchingAnswers([])
    setMatchingSelections({})
    setMatchingScore(null)
  }

  async function submitMatchingQuiz() {
    if (!canSubmitMatching) return
    const results = quizQuestions.map(question => ({
      questionId: question.id,
      correct: matchingSelections[question.id] === question.id,
    }))
    const recorded = await onReviewQuestions(results)
    if (!recorded) return
    setMatchingScore({ correct: results.filter(result => result.correct).length, total: results.length })
  }

  const recordAnswer = useCallback(async (correct: boolean) => {
    if (!currentQuestion) return
    const recorded = await onReviewQuestion(currentQuestion.id, correct)
    if (!recorded) return
    if (activeIndex >= quizQuestions.length - 1) {
      setSessionActive(false)
      setTimedMode(false)
      setTimedOutQuestionId(null)
      setAnswerRevealed(false)
      setUserAnswer('')
      setSelectedOption('')
      return
    }
    setCurrentIndex(index => index + 1)
    setSecondsLeft(TIMED_QUIZ_SECONDS)
    setTimedOutQuestionId(null)
    setAnswerRevealed(false)
    setUserAnswer('')
    setSelectedOption('')
  }, [activeIndex, currentQuestion, onReviewQuestion, quizQuestions.length])

  useEffect(() => {
    if (!sessionActive || !timedMode || !currentQuestion || answerRevealed || questionMutating) return
    const timeout = window.setTimeout(() => {
      if (secondsLeft <= 0) {
        if (timedOutQuestionId === currentQuestion.id) return
        setTimedOutQuestionId(currentQuestion.id)
        void recordAnswer(false)
      }
      else setSecondsLeft(value => Math.max(0, value - 1))
    }, secondsLeft <= 0 ? 0 : 1000)
    return () => window.clearTimeout(timeout)
  }, [answerRevealed, currentQuestion, questionMutating, recordAnswer, secondsLeft, sessionActive, timedMode, timedOutQuestionId])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Quiz · active recall</p>
          <h2 className="font-display mt-1" style={{ fontSize: '1.25rem', fontWeight: 500 }}>Test Your Knowledge</h2>
          <p className="rr-prose mt-1" style={{ fontSize: '0.95rem' }}>
            {card.quizQuestionCount} {card.quizQuestionCount === 1 ? 'question' : 'questions'} currently attached to this card.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/spaced-repetition" className="rr-btn">Learn more</Link>
          <button className="rr-btn rr-btn-icon" disabled aria-label="Open quiz settings for this card (planned)" title="Card quiz settings are planned with the review engine."><Settings size={14} aria-hidden="true" /><span>Settings</span></button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="rr-card p-4 text-left"
          disabled={generatingQuestions}
          aria-label="Generate quiz questions for this card"
          title="Generate local active-recall questions from this card's Notebook and Reader content."
          style={{ borderRadius: 3, cursor: generatingQuestions ? 'wait' : 'pointer' }}
          onClick={onGenerateQuestions}
          type="button"
        >
          <span className="rr-mono" style={{ color: 'var(--accent)' }}>{generatingQuestions ? 'Generating…' : 'Generate Questions'}</span>
          <span className="rr-prose mt-2 block" style={{ fontSize: '0.92rem' }}>Create short-answer and multiple-choice questions from this card&apos;s Notebook and Reader content.</span>
        </button>
        <button
          className="rr-card p-4 text-left"
          aria-expanded={creatingCustom}
          aria-controls="custom-question-form"
          aria-label="Create a custom quiz question for this card"
          title="Write a short-answer prompt and answer for this card."
          style={{ borderRadius: 3, cursor: questionMutating ? 'wait' : 'pointer' }}
          onClick={() => setCreatingCustom(value => !value)}
          type="button"
          disabled={questionMutating}
        >
          <span className="rr-mono" style={{ color: 'var(--accent)' }}>Create Custom</span>
          <span className="rr-prose mt-2 block" style={{ fontSize: '0.92rem' }}>Write your own short-answer active-recall prompt.</span>
        </button>
      </div>
      {creatingCustom && (
        <form id="custom-question-form" className="rr-card space-y-3 p-4" style={{ borderRadius: 3 }} onSubmit={submitCustomQuestion}>
          <label className="block">
            <span className="rr-mono">Question prompt</span>
            <textarea
              value={customPrompt}
              onChange={event => setCustomPrompt(event.target.value)}
              aria-label="Question prompt"
              className="mt-2 min-h-24 w-full resize-y bg-transparent p-3 outline-none rr-rule rr-prose"
              maxLength={1200}
              disabled={questionMutating}
            />
          </label>
          <label className="block">
            <span className="rr-mono">Expected answer</span>
            <textarea
              value={customAnswer}
              onChange={event => setCustomAnswer(event.target.value)}
              aria-label="Expected answer"
              className="mt-2 min-h-24 w-full resize-y bg-transparent p-3 outline-none rr-rule rr-prose"
              maxLength={1200}
              disabled={questionMutating}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="rr-btn rr-btn-accent rr-btn-icon" disabled={!canSaveCustom} type="submit">
              <Check size={14} aria-hidden="true" />
              <span>{questionMutating ? 'Saving…' : 'Save question'}</span>
            </button>
            <button className="rr-btn" type="button" disabled={questionMutating} onClick={() => setCreatingCustom(false)}>Cancel</button>
          </div>
        </form>
      )}
      {sessionActive && currentQuestion && (
        <section className="rr-card space-y-4 p-5" style={{ borderRadius: 3 }} aria-label="Card quiz session">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="rr-mono">Question {activeIndex + 1} of {quizQuestions.length}</p>
                {timedMode && <span className="rr-tag">Timed · {formatQuizTime(secondsLeft)}</span>}
              </div>
              <h3 className="font-display mt-2" style={{ fontSize: '1.15rem', fontWeight: 500, overflowWrap: 'anywhere' }}>{currentQuestion.prompt}</h3>
            </div>
            <button className="rr-btn" type="button" onClick={endQuiz} disabled={questionMutating}>End quiz</button>
          </div>
          {currentIsMcq ? (
            <fieldset className="space-y-2" disabled={questionMutating || answerRevealed}>
              <legend className="rr-mono">Choose an answer</legend>
              {currentOptions.map(option => (
                <label key={option} className="rr-card flex cursor-pointer items-start gap-3 p-3" style={{ borderRadius: 3 }}>
                  <input
                    type="radio"
                    name={`quiz-option-${currentQuestion.id}`}
                    value={option}
                    checked={selectedOption === option}
                    onChange={() => setSelectedOption(option)}
                    className="mt-1"
                  />
                  <span className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{option}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <label className="block">
              <span className="rr-mono">Your answer</span>
              <textarea
                value={userAnswer}
                onChange={event => setUserAnswer(event.target.value)}
                aria-label="Your answer"
                className="mt-2 min-h-24 w-full resize-y bg-transparent p-3 outline-none rr-rule rr-prose"
                disabled={questionMutating || answerRevealed}
              />
            </label>
          )}
          {!answerRevealed ? (
            <button className="rr-btn rr-btn-accent rr-btn-icon" type="button" onClick={() => setAnswerRevealed(true)}>
              <Eye size={14} aria-hidden="true" />
              <span>Reveal answer</span>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="rr-rule p-3">
                <div className="rr-mono mb-1">Expected answer</div>
                <p className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{currentQuestion.answer}</p>
              </div>
              {userAnswer.trim() && (
                <div className="rr-rule p-3">
                  <div className="rr-mono mb-1">Your answer</div>
                  <p className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{userAnswer}</p>
                </div>
              )}
              {currentIsMcq && selectedOption && (
                <div className="rr-rule p-3">
                  <div className="rr-mono mb-1">Your choice</div>
                  <p className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{selectedOption}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="rr-btn rr-btn-accent rr-btn-icon" type="button" disabled={questionMutating || currentIsMcq && !selectedOption} onClick={() => void recordAnswer(currentIsMcq ? normalizeAnswer(selectedOption) === normalizeAnswer(currentQuestion.answer) : true)}>
                  <Check size={14} aria-hidden="true" />
                  <span>{currentIsMcq ? 'Submit choice' : 'Mark correct'}</span>
                </button>
                {!currentIsMcq && <button className="rr-btn rr-btn-icon" type="button" disabled={questionMutating} onClick={() => void recordAnswer(false)}>
                  <RotateCcw size={14} aria-hidden="true" />
                  <span>Practice again</span>
                </button>}
              </div>
            </div>
          )}
        </section>
      )}
      {matchingActive && (
        <section className="rr-card space-y-4 p-5" style={{ borderRadius: 3 }} aria-label="Card matching quiz session">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="rr-mono">Matching · {quizQuestions.length} pairs</p>
              <h3 className="font-display mt-2" style={{ fontSize: '1.15rem', fontWeight: 500 }}>Match Questions to Answers</h3>
              {matchingScore && <p className="rr-prose mt-1" style={{ fontSize: '0.94rem' }}>Score: {matchingScore.correct} of {matchingScore.total} correct.</p>}
            </div>
            <button className="rr-btn" type="button" onClick={endMatchingQuiz} disabled={questionMutating}>End matching</button>
          </div>
          <div className="space-y-3">
            {quizQuestions.map((question, index) => {
              const selectedId = matchingSelections[question.id] ?? ''
              const resultKnown = Boolean(matchingScore)
              const matched = selectedId === question.id
              return (
                <label key={question.id} className="rr-rule block p-3">
                  <span className="rr-mono">Prompt {index + 1}</span>
                  <span className="rr-prose mt-1 block" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{question.prompt}</span>
                  <select
                    className="rr-rule rr-prose mt-3 w-full bg-transparent p-3 outline-none"
                    value={selectedId}
                    onChange={event => setMatchingSelections(current => ({ ...current, [question.id]: event.target.value }))}
                    disabled={questionMutating || resultKnown}
                    aria-label={`Matching answer for ${shortQuestionLabel(question.prompt)}`}
                  >
                    <option value="">Choose an answer</option>
                    {matchingAnswers.map(answerQuestion => (
                      <option key={answerQuestion.id} value={answerQuestion.id}>{shortQuestionLabel(answerQuestion.answer)}</option>
                    ))}
                  </select>
                  {resultKnown && <span className="rr-mono mt-2 block" style={{ color: matched ? 'var(--success)' : 'var(--danger)' }}>{matched ? 'Correct' : `Answer: ${shortQuestionLabel(question.answer)}`}</span>}
                </label>
              )
            })}
          </div>
          <button className="rr-btn rr-btn-accent rr-btn-icon" type="button" disabled={!canSubmitMatching} onClick={() => void submitMatchingQuiz()}>
            <Check size={14} aria-hidden="true" />
            <span>{questionMutating ? 'Submitting…' : matchingScore ? 'Review submitted' : 'Submit matches'}</span>
          </button>
        </section>
      )}
      {card.quizQuestions.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-display" style={{ fontSize: '1.08rem', fontWeight: 500 }}>Existing questions</h3>
            <div className="flex flex-wrap gap-2">
              <button className="rr-btn rr-btn-accent" onClick={() => startQuiz()} type="button" aria-label="Start quiz for this card" title="Run a self-graded quiz for this card.">Start quiz for this card</button>
              <button className="rr-btn" onClick={() => startQuiz(true)} type="button" aria-label="Start timed quiz for this card" title="Run a 60-second-per-question quiz for this card.">Start timed quiz</button>
              <button className="rr-btn" onClick={startMatchingQuiz} disabled={!canStartMatching || matchingActive} type="button" aria-label="Start matching quiz for this card" title={canStartMatching ? "Match this card's prompts to their expected answers." : 'Matching quiz needs at least two questions.'}>Start matching</button>
            </div>
          </div>
          <div className="space-y-3">
            {quizQuestions.map(question => (
              <article key={question.id} className="rr-card p-4" style={{ borderRadius: 3 }}>
                <div className="flex flex-wrap gap-2">
                  <span className="rr-tag">{question.type}</span>
                  <span className="rr-tag">{question.memoryStage}</span>
                  <span className="rr-tag">{question.origin}</span>
                  <span className="rr-tag">{questionDueLabel(question.dueAt)}</span>
                </div>
                {editingQuestionId === question.id ? (
                  <form className="mt-4 space-y-3" onSubmit={submitQuestionEdit}>
                    <label className="block">
                      <span className="rr-mono">Question prompt</span>
                      <textarea
                        value={editPrompt}
                        onChange={event => setEditPrompt(event.target.value)}
                        aria-label={`Question prompt for ${question.prompt}`}
                        className="mt-2 min-h-24 w-full resize-y bg-transparent p-3 outline-none rr-rule rr-prose"
                        maxLength={1200}
                        disabled={questionMutating}
                      />
                    </label>
                    <label className="block">
                      <span className="rr-mono">Expected answer</span>
                      <textarea
                        value={editAnswer}
                        onChange={event => setEditAnswer(event.target.value)}
                        aria-label={`Expected answer for ${question.prompt}`}
                        className="mt-2 min-h-24 w-full resize-y bg-transparent p-3 outline-none rr-rule rr-prose"
                        maxLength={1200}
                        disabled={questionMutating}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button className="rr-btn rr-btn-accent rr-btn-icon" type="submit" disabled={!canSaveEdit}>
                        <Check size={14} aria-hidden="true" />
                        <span>{questionMutating ? 'Saving…' : 'Save edits'}</span>
                      </button>
                      <button className="rr-btn" type="button" disabled={questionMutating} onClick={cancelQuestionEdit}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="font-display mt-3" style={{ fontSize: '1rem', overflowWrap: 'anywhere' }}>{question.prompt}</p>
                    {questionOptions(question).length > 0 && (
                      <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.94rem' }}>
                        {questionOptions(question).map(option => (
                          <li key={option}>{normalizeAnswer(option) === normalizeAnswer(question.answer) ? '✓ ' : ''}{option}</li>
                        ))}
                      </ul>
                    )}
                    <p className="rr-prose mt-2" style={{ fontSize: '0.94rem', overflowWrap: 'anywhere' }}>{question.answer}</p>
                    <div className="mt-3 flex flex-wrap gap-2 rr-mono">
                      <span>{question.timesSeen} seen</span>
                      <span>{question.timesCorrect} correct</span>
                      {question.lastReviewed && <span>reviewed {relativeTime(question.lastReviewed)}</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rr-btn rr-btn-icon"
                        type="button"
                        onClick={() => startQuestionEdit(question)}
                        disabled={questionMutating}
                        aria-label={`Edit quiz question: ${shortQuestionLabel(question.prompt)}`}
                        title="Edit this question prompt and expected answer."
                      >
                        <Pencil size={14} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        className="rr-btn rr-btn-icon"
                        type="button"
                        onClick={() => void deleteQuestion(question.id)}
                        disabled={questionMutating}
                        aria-label={`Delete quiz question: ${shortQuestionLabel(question.prompt)}`}
                        title="Delete this quiz question from the card."
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div className="rr-card p-4" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.94rem' }}>No questions have been saved for this card yet. Generate from the Notebook or create a custom short-answer prompt.</p>
        </div>
      )}
    </div>
  )
}

function sortedQuizQuestions(questions: CardQuizQuestion[]): CardQuizQuestion[] {
  return [...questions].sort((a, b) => questionSortScore(a) - questionSortScore(b))
}

function shuffleQuizQuestions(questions: CardQuizQuestion[]): CardQuizQuestion[] {
  const shuffled = [...questions]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  return shuffled
}

function questionOptions(question: CardQuizQuestion | null): string[] {
  return question?.type === 'mcq' && Array.isArray(question.options) ? question.options.filter(Boolean) : []
}

function normalizeAnswer(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function formatQuizTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function questionSortScore(question: CardQuizQuestion): number {
  if (!question.dueAt) return 0
  const due = new Date(question.dueAt).getTime()
  return Number.isNaN(due) ? 0 : due
}

function questionDueLabel(dueAt: string | null): string {
  if (!dueAt) return 'unscheduled'
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return 'unscheduled'
  if (due <= Date.now()) return 'due now'
  return `due ${new Date(dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

function shortQuestionLabel(prompt: string): string {
  return prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt
}

function ConnectionsPanel({
  card,
  relatedCards,
  relatedLoading,
  relatedError,
  manualLinkDraft,
  connectionMutating,
  setManualLinkDraft,
  onCreateManualConnection,
  onRemoveConnection,
  onGenerateConnections,
  onRetryRelated,
  generatingConnections,
}: {
  card: CardDetail
  relatedCards: RelatedCard[]
  relatedLoading: boolean
  relatedError: string | null
  manualLinkDraft: string
  connectionMutating: boolean
  setManualLinkDraft: (value: string) => void
  onCreateManualConnection: (input: { targetId?: string; targetTitle?: string; label?: string }) => void
  onRemoveConnection: (connectionId: string) => void
  onGenerateConnections: () => void
  onRetryRelated: () => void
  generatingConnections: boolean
}) {
  const groups = groupConnections(card.connections)
  const incomingGroups = groupConnections(card.incomingConnections)
  const savedTargetIds = new Set(card.connections.map(connection => connection.to?.id).filter((id): id is string => Boolean(id)))
  const incomingSourceIds = new Set(card.incomingConnections.map(connection => connection.from?.id).filter((id): id is string => Boolean(id)))
  const linkedCount = card.connections.length + card.incomingConnections.length + relatedCards.filter(item => !savedTargetIds.has(item.id) && !incomingSourceIds.has(item.id)).length

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Connections · Phase 2</p>
          <h2 className="font-display mt-1" style={{ fontSize: '1.25rem', fontWeight: 500 }}>{linkedCount} linked items</h2>
          <p className="rr-prose mt-1" style={{ fontSize: '0.95rem' }}>
            Related cards are ranked from local full-card embeddings. Generate entity links from local card metadata, save a card link here, or type <code>[[card title]]</code> in the Notebook and save it. Backlinks show cards that already point here.
          </p>
        </div>
        <button
          className="rr-btn rr-btn-icon"
          onClick={onGenerateConnections}
          disabled={generatingConnections}
          aria-label="Generate entity links for this card"
          title="Generate local entity links from this card's extracted entities, semantic tags, and tags."
          type="button"
        >
          <Link2 size={14} aria-hidden="true" />
          <span>{generatingConnections ? 'Generating…' : 'Generate Entity Links'}</span>
        </button>
      </div>

      <form
        className="rr-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
        style={{ borderRadius: 3 }}
        onSubmit={e => {
          e.preventDefault()
          const targetTitle = manualLinkDraft.trim()
          if (targetTitle) onCreateManualConnection({ targetTitle, label: targetTitle })
        }}
      >
        <label className="flex-1">
          <span className="rr-mono" style={{ color: 'var(--accent)' }}>Manual card link</span>
          <input
            aria-label="Card title to link"
            value={manualLinkDraft}
            onChange={e => setManualLinkDraft(e.target.value)}
            placeholder="Spaced repetition"
            disabled={connectionMutating}
            className="mt-2 w-full bg-transparent outline-none rr-prose"
            style={{ border: '1px solid var(--hairline)', borderRadius: 3, padding: '0.55rem 0.65rem' }}
          />
        </label>
        <button
          className="rr-btn rr-btn-accent rr-btn-icon"
          disabled={connectionMutating || !manualLinkDraft.trim()}
          aria-label="Save manual card link"
          type="submit"
        >
          <Link2 size={14} aria-hidden="true" />
          <span>{connectionMutating ? 'Saving…' : 'Save Link'}</span>
        </button>
      </form>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-display" style={{ fontSize: '1.08rem', fontWeight: 500 }}>Related cards</h3>
          {relatedLoading && <span className="rr-mono">ranking embeddings…</span>}
        </div>
        {relatedError && (
          <div className="rr-card p-4" style={{ borderRadius: 3 }}>
            <p className="rr-prose" style={{ fontSize: '0.94rem' }}>{relatedError}</p>
            <button className="rr-btn mt-3" onClick={onRetryRelated} disabled={relatedLoading}>{relatedLoading ? 'Retrying…' : 'Retry related cards'}</button>
          </div>
        )}
        {!relatedError && !relatedLoading && relatedCards.length === 0 && (
          <div className="rr-card p-4" style={{ borderRadius: 3 }}>
            <p className="rr-prose" style={{ fontSize: '0.94rem' }}>No related cards ranked yet.</p>
          </div>
        )}
        {!relatedError && relatedCards.length > 0 && (
          <div className="grid gap-3">
            {relatedCards.map(item => {
              const alreadySaved = savedTargetIds.has(item.id)
              const alreadyInbound = incomingSourceIds.has(item.id)
              return (
                <article
                  key={item.id}
                  className="rr-card p-4 rr-rise"
                  style={{ borderRadius: 3 }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span className="rr-mono" style={{ color: 'var(--accent)' }}>{item.provider ?? item.sourceType}</span>
                      <Link href={`/item/${item.id}`} className="rr-link">
                        <h4 className="font-display mt-1" style={{ fontSize: '1rem', fontWeight: 500, overflowWrap: 'anywhere' }}>{item.title}</h4>
                      </Link>
                    </div>
                    <span className="rr-tag shrink-0">{relatedScoreLabel(item.score)}</span>
                  </div>
                  {item.summary && <p className="rr-prose mt-2" style={{ fontSize: '0.92rem' }}>{item.summary}</p>}
                  {item.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.tags.slice(0, 4).map(tag => <span key={tag.slug} className="rr-tag">{tag.name}</span>)}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rr-btn rr-btn-icon"
                      disabled={connectionMutating || alreadySaved}
                      aria-label={alreadySaved ? `${item.title} is already saved as a manual card link` : alreadyInbound ? `Save return link to ${item.title}` : `Save ${item.title} as a manual card link`}
                      onClick={() => onCreateManualConnection({ targetId: item.id, label: item.title })}
                      type="button"
                    >
                      <Link2 size={14} aria-hidden="true" />
                      <span>{alreadySaved ? 'Saved link' : alreadyInbound ? 'Save return link' : 'Save link'}</span>
                    </button>
                    <Link href={`/item/${item.id}`} className="rr-btn">Open card</Link>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {groups.length > 0 ? (
        <div className="space-y-4">
          <h3 className="font-display" style={{ fontSize: '1.08rem', fontWeight: 500 }}>Outbound links</h3>
          {groups.map(group => (
            <section key={group.type} className="rr-rule pb-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="rr-mono" style={{ color: 'var(--gold)' }}>{group.type}</span>
                <span className="rr-mono">{group.items.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.items.map(item => (
                  <span key={item.id} className="rr-tag inline-flex items-center gap-1.5">
                    {item.to
                      ? <Link href={`/item/${item.to.id}`} className="rr-link">{item.label}</Link>
                      : item.label}
                    {item.origin === 'manual' && (
                      <button
                        type="button"
                        onClick={() => onRemoveConnection(item.id)}
                        disabled={connectionMutating}
                        aria-label={`Remove manual card link ${item.label}`}
                        title="Remove this manual card link"
                        className="inline-flex opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rr-card p-4" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.94rem' }}>No outbound links saved yet.</p>
        </div>
      )}

      {incomingGroups.length > 0 ? (
        <div className="space-y-4">
          <h3 className="font-display" style={{ fontSize: '1.08rem', fontWeight: 500 }}>Backlinks to this card</h3>
          {incomingGroups.map(group => (
            <section key={`incoming-${group.type}`} className="rr-rule pb-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="rr-mono" style={{ color: 'var(--gold)' }}>{group.type}</span>
                <span className="rr-mono">{group.items.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.items.map(item => (
                  <span key={item.id} className="rr-tag inline-flex items-center gap-1.5">
                    {item.from
                      ? <Link href={`/item/${item.from.id}`} className="rr-link">{cardConnectionTitle(item.from)}</Link>
                      : item.label}
                    <span className="rr-mono" style={{ color: 'var(--sepia)' }}>links here</span>
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rr-card p-4" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.94rem' }}>No backlinks point to this card yet.</p>
        </div>
      )}
    </div>
  )
}

function GraphPanel({
  card,
  relatedCards,
  relatedLoading,
  relatedError,
  onRetryRelated,
}: {
  card: CardDetail
  relatedCards: RelatedCard[]
  relatedLoading: boolean
  relatedError: string | null
  onRetryRelated: () => void
}) {
  const [depth, setDepth] = useState<GraphDepth>(2)
  const [fitMode, setFitMode] = useState<GraphFitMode>('spread')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showRelated, setShowRelated] = useState(true)
  const [showEntities, setShowEntities] = useState(true)
  const [showContext, setShowContext] = useState(true)
  const [showScores, setShowScores] = useState(true)
  const [typeFilters, setTypeFilters] = useState<Record<string, boolean>>({})
  const [graphData, setGraphData] = useState<CardGraph | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [graphReloadKey, setGraphReloadKey] = useState(0)

  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullscreen])

  useEffect(() => {
    let cancelled = false
    const loadGraph = async () => {
      setGraphLoading(true)
      setGraphError(null)
      try {
        const res = await fetch(`/api/cards/${card.id}/graph?depth=${depth}`)
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(apiError(data, 'Could not load graph traversal'))
        if (!isGraphResponse(data)) throw new Error('The local graph API returned an unexpected response')
        if (!cancelled) setGraphData(data.graph)
      } catch (err) {
        if (!cancelled) {
          setGraphError(err instanceof Error ? err.message : 'Could not load graph traversal')
          setGraphData(null)
        }
      } finally {
        if (!cancelled) setGraphLoading(false)
      }
    }
    void loadGraph()
    return () => { cancelled = true }
  }, [card.id, depth, graphReloadKey])

  const availableTypes = graphAvailableTypes(card, graphData)
  const visibleNodes = buildGraphNodes({
    card,
    graph: graphData,
    relatedCards,
    depth,
    showRelated,
    showEntities,
    showContext,
    typeFilters,
  })
  const visibleEdges = buildGraphEdges({
    card,
    graph: graphData,
    nodes: visibleNodes,
  })
  const hiddenTypeCount = availableTypes.filter(type => typeFilters[type] === false).length
  const graphSummary = `${visibleNodes.length} visible ${visibleNodes.length === 1 ? 'node' : 'nodes'} · ${visibleEdges.length} visible ${visibleEdges.length === 1 ? 'edge' : 'edges'} · depth ${depth}`

  const setTypeFilter = (type: string, enabled: boolean) => {
    setTypeFilters(current => ({ ...current, [type]: enabled }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Graph · Phase 2</p>
          <h2 className="font-display mt-1" style={{ fontSize: '1.25rem', fontWeight: 500 }}>Connection graph</h2>
          <p className="rr-prose mt-1" style={{ fontSize: '0.94rem' }}>
            Explore related cards, multi-hop links, backlinks, saved entity links, and local card context without changing the underlying connections.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rr-btn rr-btn-icon"
            aria-pressed={fitMode === 'fit'}
            aria-label="Fit card graph to view"
            title="Compact the current graph layout so visible nodes fit tighter inside the panel."
            onClick={() => setFitMode(fitMode === 'fit' ? 'spread' : 'fit')}
            type="button"
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>{fitMode === 'fit' ? 'Fitted' : 'Fit'}</span>
          </button>
          <button
            className="rr-btn rr-btn-icon"
            aria-expanded={settingsOpen}
            aria-controls="card-graph-settings"
            aria-label={settingsOpen ? 'Close card graph settings' : 'Open card graph settings'}
            title="Filter graph node families and entity types locally."
            onClick={() => setSettingsOpen(open => !open)}
            type="button"
          >
            <Settings size={14} aria-hidden="true" />
            <span>Settings</span>
          </button>
          <button
            className="rr-btn rr-btn-icon"
            aria-label="Open card graph fullscreen view"
            title="Open a larger local graph view."
            onClick={() => setFullscreen(true)}
            type="button"
          >
            <Maximize2 size={14} aria-hidden="true" />
            <span>Fullscreen</span>
          </button>
        </div>
      </div>

      {settingsOpen && (
        <section id="card-graph-settings" className="rr-card p-4" style={{ borderRadius: 3 }} aria-label="Card graph settings">
          <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
            <fieldset className="space-y-2">
              <legend className="rr-mono" style={{ color: 'var(--accent)' }}>Node families</legend>
              <GraphCheckbox label="Related cards and card links" checked={showRelated} onChange={setShowRelated} />
              <GraphCheckbox label="Saved entity links" checked={showEntities} onChange={setShowEntities} />
              <GraphCheckbox label="Card context tags" checked={showContext} onChange={setShowContext} />
              <GraphCheckbox label="Show match scores" checked={showScores} onChange={setShowScores} />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="rr-mono" style={{ color: 'var(--accent)' }}>Entity types</legend>
              {availableTypes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableTypes.map(type => {
                    const checked = typeFilters[type] !== false
                    return (
                      <label key={type} className="rr-tag inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={event => setTypeFilter(type, event.currentTarget.checked)}
                          className="accent-[var(--accent)]"
                        />
                        <span>{type}</span>
                      </label>
                    )
                  })}
                </div>
              ) : (
                <p className="rr-prose" style={{ fontSize: '0.9rem' }}>Generate or save connections to unlock entity-type filters.</p>
              )}
            </fieldset>
          </div>
        </section>
      )}

      <GraphCanvas
        cardTitle={card.title}
        nodes={visibleNodes}
        edges={visibleEdges}
        fitMode={fitMode}
        showScores={showScores}
        summary={graphSummary}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <label className="block">
          <span className="rr-mono">Connection Depth</span>
          <input
            aria-label="Connection depth"
            title="Adjust local graph depth: related cards, outbound links, backlinks, saved entity links, and card context tags."
            type="range"
            min="1"
            max="3"
            value={depth}
            className="mt-2 w-full accent-[var(--accent)]"
            onChange={event => setDepth(Number(event.currentTarget.value) as GraphDepth)}
          />
        </label>
        <div className="rr-mono sm:text-right" aria-live="polite">
          {graphSummary}
          {hiddenTypeCount > 0 && <span> · {hiddenTypeCount} hidden {hiddenTypeCount === 1 ? 'type' : 'types'}</span>}
        </div>
      </div>

      {graphLoading && <p className="rr-mono">traversing graph…</p>}
      {graphError && (
        <div className="rr-card p-4" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.94rem' }}>{graphError}</p>
          <button
            className="rr-btn mt-3"
            onClick={() => {
              setGraphData(null)
              setGraphError(null)
              setGraphReloadKey(key => key + 1)
            }}
            type="button"
            disabled={graphLoading}
          >
            {graphLoading ? 'Retrying…' : 'Retry graph traversal'}
          </button>
        </div>
      )}

      {relatedLoading && <p className="rr-mono">ranking embeddings…</p>}
      {relatedError && (
        <div className="rr-card p-4" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.94rem' }}>{relatedError}</p>
          <button className="rr-btn mt-3" onClick={onRetryRelated} disabled={relatedLoading}>{relatedLoading ? 'Retrying…' : 'Retry graph ranking'}</button>
        </div>
      )}

      {visibleNodes.length === 0 && !relatedLoading && !relatedError && (
        <div className="rr-card p-4" style={{ borderRadius: 3 }}>
          <p className="rr-prose" style={{ fontSize: '0.94rem' }}>No graph nodes match the current depth and filters.</p>
          <button
            className="rr-btn mt-3"
            onClick={() => {
              setDepth(2)
              setShowRelated(true)
              setShowEntities(true)
              setShowContext(true)
              setTypeFilters({})
            }}
            type="button"
          >
            Reset graph filters
          </button>
        </div>
      )}

      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,23,20,0.55)] p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Card graph fullscreen view"
        >
          <div className="rr-card flex max-h-[92vh] w-full max-w-6xl flex-col gap-4 overflow-auto p-4 sm:p-6" style={{ borderRadius: 3 }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="rr-mono" style={{ color: 'var(--accent)' }}>Graph fullscreen</p>
                <h3 className="font-display mt-1" style={{ fontSize: '1.35rem', fontWeight: 500 }}>Connection graph</h3>
              </div>
              <button className="rr-btn rr-btn-icon" onClick={() => setFullscreen(false)} aria-label="Close fullscreen graph" type="button">
                <X size={14} aria-hidden="true" />
                <span>Close</span>
              </button>
            </div>
            <GraphCanvas
              cardTitle={card.title}
              nodes={visibleNodes}
              edges={visibleEdges}
              fitMode={fitMode}
              showScores={showScores}
              summary={graphSummary}
              fullscreen
            />
          </div>
        </div>
      )}
    </div>
  )
}

function GraphCanvas({
  cardTitle,
  nodes,
  edges,
  fitMode,
  showScores,
  summary,
  fullscreen = false,
}: {
  cardTitle: string
  nodes: GraphNode[]
  edges: GraphRenderEdge[]
  fitMode: GraphFitMode
  showScores: boolean
  summary: string
  fullscreen?: boolean
}) {
  const positionedNodes = nodes.map((node, index) => ({ ...node, ...graphNodePosition(index, Math.max(nodes.length, 1), fitMode) }))
  const nodePositions = new Map<string, { x: number; y: number }>([
    ['root', { x: 50, y: 50 }],
    ...positionedNodes.map(node => [node.id, { x: node.x, y: node.y }] as const),
  ])
  const visibleEdges = edges.filter(edge => nodePositions.has(edge.fromNodeId) && nodePositions.has(edge.toNodeId))
  const legendItems = graphEdgeLegendItems(visibleEdges)
  const markerId = fullscreen ? 'graph-edge-arrow-fullscreen' : 'graph-edge-arrow-inline'

  return (
    <div className={`rr-card overflow-hidden p-5 ${fullscreen ? 'min-h-[64vh]' : 'min-h-72'}`} style={{ borderRadius: 3 }}>
      <div className="rr-mono mb-3" style={{ color: 'var(--sepia)' }}>{summary}</div>
      <div
        className={`relative mx-auto flex ${fullscreen ? 'min-h-[58vh] max-w-5xl' : 'min-h-72 max-w-3xl'} items-center justify-center`}
        aria-label={`Visible card graph with ${nodes.length} nodes and ${visibleEdges.length} edges`}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" opacity="0.68" />
            </marker>
          </defs>
          {visibleEdges.map((edge, index) => {
            const from = nodePositions.get(edge.fromNodeId)
            const to = nodePositions.get(edge.toNodeId)
            if (!from || !to) return null
            const style = graphEdgeStyle(edge.kind)
            const markerEnd = edge.kind === 'manual' || edge.kind === 'incoming' || edge.kind === 'linked' ? `url(#${markerId})` : undefined
            return (
              <path
                key={edge.id}
                d={graphEdgePath(from, to, index)}
                fill="none"
                stroke={style.stroke}
                strokeDasharray={style.strokeDasharray}
                strokeWidth={style.strokeWidth}
                markerEnd={markerEnd}
                opacity={style.opacity}
                vectorEffect="non-scaling-stroke"
              >
                <title>{graphEdgeTitle(edge)}</title>
              </path>
            )
          })}
        </svg>
        <div
          className="relative z-20 max-w-48 border px-4 py-3 text-center"
          style={{ borderRadius: 3, borderColor: 'var(--accent)', background: 'var(--card)' }}
        >
          <div className="rr-mono" style={{ color: 'var(--accent)' }}>Current card</div>
          <div className="font-display mt-1" style={{ fontSize: '1rem', overflowWrap: 'anywhere' }}>{cardTitle}</div>
        </div>
        {positionedNodes.map((node) => (
          node.href ? (
            <Link
              key={node.id}
              href={node.href}
              className="rr-tag absolute z-20 bg-[var(--card)]"
              style={graphNodeStyle(node, fitMode)}
              aria-label={`Open graph card ${node.label}`}
              title={graphNodeTitle(node, showScores)}
            >
              {node.label}
              {showScores && typeof node.score === 'number' && <span className="rr-mono ml-1">{relatedScoreLabel(node.score)}</span>}
            </Link>
          ) : (
            <span
              key={node.id}
              className="rr-tag absolute z-20 bg-[var(--card)]"
              style={graphNodeStyle(node, fitMode)}
              title={graphNodeTitle(node, showScores)}
            >
              {node.label}
            </span>
          )
        ))}
      </div>
      {visibleEdges.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-[auto_1fr] md:items-start">
          <div className="flex flex-wrap gap-2" aria-label="Graph edge legend">
            {legendItems.map(item => (
              <span key={item.kind} className="rr-tag inline-flex items-center gap-2">
                <span className="inline-block h-px w-7" style={{ background: item.stroke, borderTop: item.dashed ? `1px dashed ${item.stroke}` : undefined }} aria-hidden="true" />
                <span>{item.label}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Visible graph edges">
            {visibleEdges.slice(0, 6).map(edge => (
              <span key={edge.id} className="rr-tag" title={graphEdgeTitle(edge)}>
                {graphEdgeCompactLabel(edge)}
              </span>
            ))}
            {visibleEdges.length > 6 && <span className="rr-tag">+{visibleEdges.length - 6} more edges</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function GraphCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 rr-prose" style={{ fontSize: '0.94rem' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.currentTarget.checked)}
        className="accent-[var(--accent)]"
      />
      <span>{label}</span>
    </label>
  )
}

function groupConnections(connections: CardDetail['connections']) {
  const groups = new Map<string, CardDetail['connections']>()
  for (const connection of connections) {
    groups.set(connection.entityType, [...(groups.get(connection.entityType) ?? []), connection])
  }
  return [...groups.entries()].map(([type, items]) => ({ type, items }))
}

function relatedScoreLabel(score: number): string {
  if (!Number.isFinite(score)) return 'related'
  return `${Math.max(0, Math.min(100, Math.round(score * 100)))}% match`
}

function cardConnectionTitle(card: { title: string | null; text: string }): string {
  return card.title || card.text.slice(0, 120) || 'Untitled'
}

function buildGraphNodes({
  card,
  graph,
  relatedCards,
  depth,
  showRelated,
  showEntities,
  showContext,
  typeFilters,
}: {
  card: CardDetail
  graph: CardGraph | null
  relatedCards: RelatedCard[]
  depth: GraphDepth
  showRelated: boolean
  showEntities: boolean
  showContext: boolean
  typeFilters: Record<string, boolean>
}): GraphNode[] {
  const nodes: GraphNode[] = []
  const seen = new Set<string>()
  const typeEnabled = (type: string) => typeFilters[type] !== false
  const linkedHrefs = new Set<string>()
  const add = (node: GraphNode) => {
    const key = node.href ? `${node.kind}:${node.href}` : `${node.type}:${node.label.toLowerCase()}`
    if (seen.has(key) || !typeEnabled(node.type)) return
    seen.add(key)
    if (node.href && node.kind !== 'related') linkedHrefs.add(node.href)
    nodes.push(node)
  }

  if (graph) {
    const directEdges = graph.edges.filter(edge => edge.fromId === graph.rootId || edge.toId === graph.rootId)
    for (const graphCard of graph.cards) {
      if (graphCard.id === graph.rootId || graphCard.depth > depth || !showRelated) continue
      const href = `/item/${graphCard.id}`
      const directEdge = directEdges.find(edge => edge.fromId === graphCard.id || edge.toId === graphCard.id)
      const direction = directEdge?.fromId === graph.rootId ? 'outbound' : directEdge?.toId === graph.rootId ? 'inbound' : undefined
      add({
        id: `graph-card-${graphCard.id}`,
        label: graphCard.title,
        type: direction === 'inbound' ? 'Inbound card' : direction === 'outbound' ? 'Manual card' : 'Linked card',
        kind: direction === 'inbound' ? 'incoming-card' : direction === 'outbound' ? 'manual-card' : 'linked-card',
        graphId: graphCard.id,
        href,
        origin: directEdge?.origin,
        direction,
        depth: graphCard.depth,
      })
    }
    if (showEntities) {
      for (const entity of graph.entities) {
        if (entity.depth > depth) continue
        add({
          id: `graph-entity-${entity.id}`,
          label: entity.label,
          type: entity.entityType,
          kind: 'entity',
          graphId: entity.id,
          fromGraphId: entity.fromCardId,
          origin: entity.origin,
          depth: entity.depth,
        })
      }
    }
  } else {
    for (const connection of card.connections) {
      if (connection.to && depth >= 1 && showRelated) {
        add({
          id: `manual-${connection.id}`,
          label: connection.label,
          type: 'Manual card',
          kind: 'manual-card',
          graphId: connection.to.id,
          href: `/item/${connection.to.id}`,
          origin: connection.origin,
          direction: 'outbound',
        })
      }
    }

    for (const connection of card.incomingConnections) {
      if (connection.from && depth >= 1 && showRelated) {
        add({
          id: `incoming-${connection.id}`,
          label: cardConnectionTitle(connection.from),
          type: 'Inbound card',
          kind: 'incoming-card',
          graphId: connection.from.id,
          href: `/item/${connection.from.id}`,
          origin: connection.origin,
          direction: 'inbound',
        })
      }
    }

    for (const connection of card.connections) {
      if (!connection.to && depth >= 2 && showEntities) {
        add({
          id: `entity-${connection.id}`,
          label: connection.label,
          type: connection.entityType,
          kind: 'entity',
          graphId: connection.id,
          fromGraphId: card.id,
          origin: connection.origin,
        })
      }
    }
  }

  if (showRelated) {
    for (const related of relatedCards.slice(0, depth === 1 ? 3 : 5)) {
      const href = `/item/${related.id}`
      if (linkedHrefs.has(href)) continue
      add({
        id: `related-${related.id}`,
        label: related.title,
        type: 'Related card',
        kind: 'related',
        graphId: related.id,
        href,
        score: related.score,
      })
    }
  }

  if (depth >= 3 && showContext) {
    for (const tag of card.categories) {
      add({ id: `category-${tag.slug}`, label: tag.name, type: 'Tag', kind: 'context', origin: 'local' })
    }
    for (const tag of card.semanticTags.slice(0, 10)) {
      add({ id: `semantic-${tag}`, label: tag, type: 'Concept', kind: 'context', origin: 'local' })
    }
  }

  return nodes.slice(0, depth === 1 ? 8 : depth === 2 ? 14 : 20)
}

function buildGraphEdges({
  card,
  graph,
  nodes,
}: {
  card: CardDetail
  graph: CardGraph | null
  nodes: GraphNode[]
}): GraphRenderEdge[] {
  const edges: GraphRenderEdge[] = []
  const seen = new Set<string>()
  const nodeByGraphId = new Map<string, GraphNode>()
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const add = (edge: GraphRenderEdge) => {
    const key = `${edge.fromNodeId}->${edge.toNodeId}:${edge.label}:${edge.kind}`
    if (seen.has(key) || edge.fromNodeId === edge.toNodeId) return
    if (edge.fromNodeId !== 'root' && !nodeById.has(edge.fromNodeId)) return
    if (edge.toNodeId !== 'root' && !nodeById.has(edge.toNodeId)) return
    seen.add(key)
    edges.push(edge)
  }

  for (const node of nodes) {
    if (node.graphId) nodeByGraphId.set(node.graphId, node)
  }

  if (graph) {
    for (const edge of graph.edges) {
      const fromNode = edge.fromId === graph.rootId ? null : nodeByGraphId.get(edge.fromId)
      const toNode = edge.toId === graph.rootId ? null : nodeByGraphId.get(edge.toId)
      const fromNodeId = edge.fromId === graph.rootId ? 'root' : fromNode?.id
      const toNodeId = edge.toId === graph.rootId ? 'root' : toNode?.id
      if (!fromNodeId || !toNodeId) continue
      add({
        id: `graph-edge-${edge.id}`,
        fromNodeId,
        toNodeId,
        fromLabel: edge.fromId === graph.rootId ? 'Current card' : fromNode?.label ?? 'Linked card',
        toLabel: edge.toId === graph.rootId ? 'Current card' : toNode?.label ?? 'Linked card',
        label: edge.label,
        kind: edge.fromId === graph.rootId ? 'manual' : edge.toId === graph.rootId ? 'incoming' : 'linked',
        origin: edge.origin,
        entityType: edge.entityType,
        depth: edge.depth,
      })
    }

    for (const node of nodes) {
      if (node.kind !== 'entity') continue
      const fromNode = node.fromGraphId === graph.rootId || node.fromGraphId === card.id ? null : nodeByGraphId.get(node.fromGraphId ?? '')
      const fromNodeId = node.fromGraphId === graph.rootId || node.fromGraphId === card.id ? 'root' : fromNode?.id
      if (!fromNodeId) continue
      add({
        id: `entity-edge-${node.id}`,
        fromNodeId,
        toNodeId: node.id,
        fromLabel: fromNode?.label ?? 'Current card',
        toLabel: node.label,
        label: node.type,
        kind: 'entity',
        origin: node.origin,
        entityType: node.type,
        depth: node.depth,
      })
    }
  }

  for (const node of nodes) {
    if (node.kind === 'related') {
      add({
        id: `related-edge-${node.id}`,
        fromNodeId: 'root',
        toNodeId: node.id,
        fromLabel: 'Current card',
        toLabel: node.label,
        label: typeof node.score === 'number' ? relatedScoreLabel(node.score) : 'Semantic match',
        kind: 'related',
        origin: 'embedding',
      })
    }
    if (node.kind === 'context') {
      add({
        id: `context-edge-${node.id}`,
        fromNodeId: 'root',
        toNodeId: node.id,
        fromLabel: 'Current card',
        toLabel: node.label,
        label: node.type,
        kind: 'context',
        origin: node.origin,
      })
    }
    if (!graph && node.kind === 'manual-card') {
      add({
        id: `manual-edge-${node.id}`,
        fromNodeId: 'root',
        toNodeId: node.id,
        fromLabel: 'Current card',
        toLabel: node.label,
        label: node.type,
        kind: 'manual',
        origin: node.origin,
      })
    }
    if (!graph && node.kind === 'incoming-card') {
      add({
        id: `incoming-edge-${node.id}`,
        fromNodeId: node.id,
        toNodeId: 'root',
        fromLabel: node.label,
        toLabel: 'Current card',
        label: node.type,
        kind: 'incoming',
        origin: node.origin,
      })
    }
    if (!graph && node.kind === 'entity') {
      add({
        id: `fallback-entity-edge-${node.id}`,
        fromNodeId: 'root',
        toNodeId: node.id,
        fromLabel: 'Current card',
        toLabel: node.label,
        label: node.type,
        kind: 'entity',
        origin: node.origin,
        entityType: node.type,
      })
    }
  }

  return edges.slice(0, 36)
}

function graphAvailableTypes(card: CardDetail, graph: CardGraph | null): string[] {
  const types = new Set<string>(['Related card', 'Manual card'])
  for (const connection of card.connections) types.add(connection.to ? 'Manual card' : connection.entityType)
  if (card.incomingConnections.length > 0) types.add('Inbound card')
  if (graph) {
    for (const cardNode of graph.cards) if (cardNode.id !== graph.rootId && cardNode.depth > 1) types.add('Linked card')
    for (const entity of graph.entities) types.add(entity.entityType)
  }
  if (card.categories.length > 0) types.add('Tag')
  if (card.semanticTags.length > 0) types.add('Concept')
  return [...types].sort((a, b) => a.localeCompare(b))
}

function graphNodeTitle(node: GraphNode, showScores: boolean): string {
  const parts = [node.type]
  if (typeof node.depth === 'number') parts.push(`depth ${node.depth}`)
  if (node.direction) parts.push(node.direction)
  if (node.origin) parts.push(node.origin)
  if (showScores && typeof node.score === 'number') parts.push(relatedScoreLabel(node.score))
  return parts.join(' · ')
}

function graphNodePosition(index: number, total: number, fitMode: GraphFitMode): { x: number; y: number } {
  if (total === 0) return { x: 50, y: 50 }
  const radiusX = fitMode === 'fit' ? 34 : 42
  const radiusY = fitMode === 'fit' ? 31 : 38
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  const x = 50 + Math.cos(angle) * radiusX
  const y = 50 + Math.sin(angle) * radiusY
  return { x, y }
}

function graphNodeStyle(node: PositionedGraphNode, fitMode: GraphFitMode): CSSProperties {
  return {
    left: `${node.x}%`,
    top: `${node.y}%`,
    transform: 'translate(-50%, -50%)',
    maxWidth: fitMode === 'fit' ? '7.5rem' : '9.5rem',
    overflowWrap: 'anywhere',
    textAlign: 'center',
    whiteSpace: 'normal',
  }
}

function graphEdgePath(from: { x: number; y: number }, to: { x: number; y: number }, index: number): string {
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const curve = ((index % 5) - 2) * 1.15
  const controlX = midX + (-dy / length) * curve
  const controlY = midY + (dx / length) * curve
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} Q ${controlX.toFixed(2)} ${controlY.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
}

function graphEdgeStyle(kind: GraphEdgeKind): { stroke: string; strokeWidth: number; strokeDasharray?: string; opacity: number } {
  switch (kind) {
    case 'manual':
      return { stroke: 'var(--accent)', strokeWidth: 1.7, opacity: 0.72 }
    case 'incoming':
      return { stroke: '#5f4a3a', strokeWidth: 1.7, opacity: 0.68 }
    case 'linked':
      return { stroke: '#7c6a57', strokeWidth: 1.35, opacity: 0.62 }
    case 'entity':
      return { stroke: '#8b6f3d', strokeWidth: 1.15, strokeDasharray: '4 3', opacity: 0.62 }
    case 'related':
      return { stroke: '#47635a', strokeWidth: 1.15, strokeDasharray: '2 3', opacity: 0.62 }
    case 'context':
      return { stroke: '#6f675e', strokeWidth: 1, strokeDasharray: '1 4', opacity: 0.54 }
  }
}

function graphEdgeKindLabel(kind: GraphEdgeKind): string {
  switch (kind) {
    case 'manual':
      return 'Manual link'
    case 'incoming':
      return 'Backlink'
    case 'linked':
      return 'Multi-hop link'
    case 'entity':
      return 'Entity link'
    case 'related':
      return 'Semantic related'
    case 'context':
      return 'Card context'
  }
}

function graphEdgeLegendItems(edges: GraphRenderEdge[]): { kind: GraphEdgeKind; label: string; stroke: string; dashed: boolean }[] {
  const order: GraphEdgeKind[] = ['manual', 'incoming', 'linked', 'entity', 'related', 'context']
  const kinds = new Set(edges.map(edge => edge.kind))
  return order.filter(kind => kinds.has(kind)).map(kind => {
    const style = graphEdgeStyle(kind)
    return {
      kind,
      label: graphEdgeKindLabel(kind),
      stroke: style.stroke,
      dashed: Boolean(style.strokeDasharray),
    }
  })
}

function graphEdgeCompactLabel(edge: GraphRenderEdge): string {
  return `${graphEdgeKindLabel(edge.kind)} · ${edge.toLabel}`
}

function graphEdgeTitle(edge: GraphRenderEdge): string {
  const parts = [`${graphEdgeKindLabel(edge.kind)}: ${edge.fromLabel} → ${edge.toLabel}`, edge.label]
  if (typeof edge.depth === 'number') parts.push(`depth ${edge.depth}`)
  if (edge.origin) parts.push(edge.origin)
  if (edge.entityType && edge.entityType !== edge.label) parts.push(edge.entityType)
  return parts.join(' · ')
}
