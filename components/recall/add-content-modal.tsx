'use client'

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BookOpen, FileArchive, FileJson, FileText, Image as ImageIcon, Upload, type LucideIcon } from 'lucide-react'
import { useDialogFocus } from '@/lib/use-dialog-focus'
import { apiError } from '@/lib/api-client'
import { formatFileSize } from '@/lib/format'

export type AddContentTab = 'url' | 'note' | 'wiki' | 'pdf' | 'image' | 'import'
type SavedContentStatus = 'organizing' | 'summarizing' | 'ready' | 'failed'

export interface SavedContentMeta {
  kind: 'url' | 'note' | 'wiki' | 'pdf' | 'image' | 'markdown' | 'bookmarks' | 'pocket' | 'social-bookmarks'
  status: SavedContentStatus
  skipped?: boolean
  extracted?: boolean
  message?: string
}

const TABS: { id: AddContentTab; label: string }[] = [
  { id: 'url', label: 'URL' },
  { id: 'wiki', label: 'Wiki' },
  { id: 'pdf', label: 'PDF' },
  { id: 'image', label: 'Image' },
  { id: 'import', label: 'Import' },
  { id: 'note', label: 'Note' },
]

type ImportKind = 'pdf' | 'image' | 'markdown' | 'bookmarks' | 'pocket' | 'social-bookmarks'

// Every file-import source is the same flow — pick files, POST multipart, read
// {cards, failures, imported, skipped, failed}. Only the copy and the accept
// filter differ, so they live here as data and share one handler + one panel.
type ImportKindConfig = {
  id: ImportKind
  endpoint: string
  max: number
  accept: string
  icon: LucideIcon
  matches: (file: File) => boolean
  savedKind: SavedContentMeta['kind']
  /** [singular, plural] used for counts: "3 PDFs imported", "1 Pocket link imported" */
  unit: [string, string]
  /** overrides `unit` in the "N selected …" line (single-file kinds read better) */
  selectedNoun?: string
  fileNoun: string
  issuesLabel: string
  dropTitle: string
  dropHelp: string
  chooseLabel: string
  chooseAria: string
  chooseTitle: string
  importLabel: string
  /** fixed busy line; multi-file kinds fall back to a counted one */
  busyMessage?: string
  tooManyMessage: string
  wrongTypeMessage: string
  errorFallback: string
  unexpectedMessage: string
  unreachableMessage: string
  enrichMessage: string
  /** static value for SavedContentMeta.extracted; omit to read it off the first card */
  extracted?: boolean
  /** count only cards that actually extracted text when deciding to enrich */
  countExtractedOnly?: boolean
  messageSuffix?: (data: ImportResponse) => string
  tall?: boolean
}

function hasExtension(file: File, extensions: string[]): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return extensions.includes(extension)
}

const IMPORT_KINDS: Record<ImportKind, ImportKindConfig> = {
  pdf: {
    id: 'pdf',
    endpoint: '/api/import/pdf',
    max: 10,
    accept: '.pdf,application/pdf',
    icon: Upload,
    matches: file => file.type === 'application/pdf' || hasExtension(file, ['pdf']),
    savedKind: 'pdf',
    unit: ['PDF', 'PDFs'],
    fileNoun: 'PDF',
    issuesLabel: 'PDF',
    dropTitle: 'Drop PDFs here',
    dropHelp: 'Choose up to 10 PDFs. Selectable text imports directly; scanned PDFs use local OCR/vision.',
    chooseLabel: 'Choose PDFs',
    chooseAria: 'Choose PDF files',
    chooseTitle: 'Choose up to 10 PDFs to save as local document cards.',
    importLabel: 'Import PDFs',
    tooManyMessage: 'Import up to 10 PDFs at a time.',
    wrongTypeMessage: 'Only PDF files can be imported from this panel.',
    errorFallback: 'Could not import those PDFs. Check that they contain selectable text.',
    unexpectedMessage: 'The local PDF import API returned an unexpected response. Try again, or restart Recall.',
    unreachableMessage: 'Could not reach the local PDF import API. Check that Recall is still running, then try again.',
    enrichMessage: 'Summarizing PDFs with the local model…',
    extracted: true,
    tall: true,
  },
  image: {
    id: 'image',
    endpoint: '/api/import/image',
    max: 10,
    accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
    icon: ImageIcon,
    matches: file =>
      file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp' ||
      hasExtension(file, ['png', 'jpg', 'jpeg', 'webp']),
    savedKind: 'image',
    unit: ['image', 'images'],
    fileNoun: 'image',
    issuesLabel: 'Image',
    dropTitle: 'Drop images here',
    dropHelp: 'Choose up to 10 PNG, JPG, or WebP images. Recall saves the image locally and extracts OCR/vision text when the local model is available.',
    chooseLabel: 'Choose images',
    chooseAria: 'Choose image files',
    chooseTitle: 'Choose up to 10 images to save as local media cards.',
    importLabel: 'Import images',
    tooManyMessage: 'Import up to 10 images at a time.',
    wrongTypeMessage: 'Only PNG, JPG, or WebP images can be imported from this panel.',
    errorFallback: 'Could not import those images. Use PNG, JPG, or WebP files.',
    unexpectedMessage: 'The local image import API returned an unexpected response. Try again, or restart Recall.',
    unreachableMessage: 'Could not reach the local image import API. Check that Recall is still running, then try again.',
    enrichMessage: 'Summarizing images with the local model…',
    countExtractedOnly: true,
    messageSuffix: data => {
      const extracted = data.cards.filter(card => !card.skipped && card.extracted).length
      const savedWithoutText = data.cards.filter(card => !card.skipped && !card.extracted).length
      if (extracted > 0) return 'Summarizing OCR/vision text on your local model…'
      if (savedWithoutText > 0) return 'Saved locally; OCR/vision is unavailable.'
      return ''
    },
    tall: true,
  },
  bookmarks: {
    id: 'bookmarks',
    endpoint: '/api/import/bookmarks',
    max: 1,
    accept: '.html,.htm,text/html',
    icon: BookOpen,
    matches: file =>
      file.type === 'text/html' || file.type === 'application/octet-stream' || hasExtension(file, ['html', 'htm']),
    savedKind: 'bookmarks',
    unit: ['browser bookmark', 'browser bookmarks'],
    selectedNoun: 'bookmarks export',
    fileNoun: 'browser bookmarks',
    issuesLabel: 'Browser bookmarks',
    dropTitle: 'Drop browser bookmarks HTML here',
    dropHelp: 'Choose one Chrome, Firefox, or Edge bookmarks export. Recall imports public http(s) links, preserves folder paths, and skips duplicates.',
    chooseLabel: 'Choose bookmarks',
    chooseAria: 'Choose browser bookmarks file',
    chooseTitle: 'Choose one Chrome, Firefox, or Edge bookmarks HTML export.',
    importLabel: 'Import bookmarks',
    busyMessage: 'Importing browser bookmarks…',
    tooManyMessage: 'Import one browser bookmarks export at a time.',
    wrongTypeMessage: 'Only browser bookmark HTML exports can be imported from this panel.',
    errorFallback: 'Could not import that browser bookmarks export. Use a Chrome, Firefox, or Edge HTML export.',
    unexpectedMessage: 'The local browser bookmarks import API returned an unexpected response. Try again, or restart Recall.',
    unreachableMessage: 'Could not reach the local browser bookmarks import API. Check that Recall is still running, then try again.',
    enrichMessage: 'Summarizing imported bookmarks with the local model…',
    extracted: false,
  },
  pocket: {
    id: 'pocket',
    endpoint: '/api/import/pocket',
    max: 1,
    accept: '.csv,text/csv,application/csv,application/vnd.ms-excel',
    icon: FileArchive,
    matches: file =>
      file.type === 'text/csv' || file.type === 'application/csv' ||
      file.type === 'application/vnd.ms-excel' || file.type === 'application/octet-stream' ||
      hasExtension(file, ['csv']),
    savedKind: 'pocket',
    unit: ['Pocket link', 'Pocket links'],
    selectedNoun: 'Pocket CSV',
    fileNoun: 'Pocket CSV',
    issuesLabel: 'Pocket',
    dropTitle: 'Drop Pocket CSV here',
    dropHelp: 'Choose one Pocket export CSV. Recall imports public links, preserves Pocket tags/status metadata, and skips duplicates.',
    chooseLabel: 'Choose Pocket CSV',
    chooseAria: 'Choose Pocket CSV file',
    chooseTitle: 'Choose one Pocket CSV export.',
    importLabel: 'Import Pocket',
    busyMessage: 'Importing Pocket links…',
    tooManyMessage: 'Import one Pocket CSV export at a time.',
    wrongTypeMessage: 'Only Pocket CSV exports can be imported from this panel.',
    errorFallback: 'Could not import that Pocket CSV export. Use a Pocket CSV file with URL and title columns.',
    unexpectedMessage: 'The local Pocket import API returned an unexpected response. Try again, or restart Recall.',
    unreachableMessage: 'Could not reach the local Pocket import API. Check that Recall is still running, then try again.',
    enrichMessage: 'Summarizing imported Pocket links with the local model…',
    extracted: false,
  },
  'social-bookmarks': {
    id: 'social-bookmarks',
    endpoint: '/api/import/social-bookmarks',
    max: 1,
    accept: '.json,application/json',
    icon: FileJson,
    matches: file =>
      file.type === 'application/json' || file.type === 'application/octet-stream' || hasExtension(file, ['json']),
    savedKind: 'social-bookmarks',
    unit: ['Social Bookmarks item', 'Social Bookmarks items'],
    selectedNoun: 'Social Bookmarks JSON',
    fileNoun: 'Social Bookmarks JSON',
    issuesLabel: 'Social Bookmarks',
    dropTitle: 'Drop Social Bookmarks JSON here',
    dropHelp: 'Choose one Social Bookmarks Triage JSON export or bookmarklet file. Recall preserves social source metadata, categories, semantic tags, actionability, and media references.',
    chooseLabel: 'Choose Social JSON',
    chooseAria: 'Choose Social Bookmarks JSON file',
    chooseTitle: 'Choose one Social Bookmarks Triage JSON export or bookmarklet file.',
    importLabel: 'Import Social Bookmarks',
    busyMessage: 'Importing Social Bookmarks…',
    tooManyMessage: 'Import one Social Bookmarks Triage JSON export at a time.',
    wrongTypeMessage: 'Only Social Bookmarks Triage JSON exports can be imported from this panel.',
    errorFallback: 'Could not import that Social Bookmarks Triage JSON export. Use a JSON export or bookmarklet file.',
    unexpectedMessage: 'The local Social Bookmarks import API returned an unexpected response. Try again, or restart Recall.',
    unreachableMessage: 'Could not reach the local Social Bookmarks import API. Check that Recall is still running, then try again.',
    enrichMessage: 'Summarizing imported Social Bookmarks with the local model…',
    extracted: true,
  },
  markdown: {
    id: 'markdown',
    endpoint: '/api/import/markdown',
    max: 10,
    accept: '.md,.markdown,text/markdown,text/x-markdown',
    icon: FileText,
    matches: file =>
      file.type === 'text/markdown' || file.type === 'text/x-markdown' || hasExtension(file, ['md', 'markdown']),
    savedKind: 'markdown',
    unit: ['Markdown file', 'Markdown files'],
    fileNoun: 'Markdown',
    issuesLabel: 'Markdown',
    dropTitle: 'Drop Markdown files here',
    dropHelp: 'Choose up to 10 `.md` or `.markdown` files. Recall stores the original Markdown as Reader text and summarizes it locally.',
    chooseLabel: 'Choose Markdown',
    chooseAria: 'Choose Markdown files',
    chooseTitle: 'Choose up to 10 Markdown files to save as local document cards.',
    importLabel: 'Import Markdown',
    tooManyMessage: 'Import up to 10 Markdown files at a time.',
    wrongTypeMessage: 'Only .md or .markdown files can be imported from this panel.',
    errorFallback: 'Could not import those Markdown files. Use .md or .markdown files.',
    unexpectedMessage: 'The local Markdown import API returned an unexpected response. Try again, or restart Recall.',
    unreachableMessage: 'Could not reach the local Markdown import API. Check that Recall is still running, then try again.',
    enrichMessage: 'Summarizing Markdown files with the local model…',
    extracted: true,
    tall: true,
  },
}

// Section + footer-button order for the Import tab.
const IMPORT_TAB_KINDS: ImportKind[] = ['bookmarks', 'pocket', 'social-bookmarks', 'markdown']

type Selection = { files: File[]; failures: ImportFailure[] }

const EMPTY_SELECTIONS: Record<ImportKind, Selection> = {
  pdf: { files: [], failures: [] },
  image: { files: [], failures: [] },
  markdown: { files: [], failures: [] },
  bookmarks: { files: [], failures: [] },
  pocket: { files: [], failures: [] },
  'social-bookmarks': { files: [], failures: [] },
}

export function AddContentModal({
  open,
  initialTab = 'url',
  onClose,
  onSaved,
}: {
  open: boolean
  initialTab?: AddContentTab
  onClose: () => void
  onSaved: (id: string, meta: SavedContentMeta) => void
}) {
  const [tab, setTab] = useState<AddContentTab>(initialTab)
  const [url, setUrl] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [noteText, setNoteText] = useState('')
  const [wikiQuery, setWikiQuery] = useState('')
  const [wikiResults, setWikiResults] = useState<WikiSearchResult[]>([])
  const [selections, setSelections] = useState<Record<ImportKind, Selection>>(EMPTY_SELECTIONS)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const inputRefs = useRef<Record<ImportKind, HTMLInputElement | null>>({
    pdf: null, image: null, markdown: null, bookmarks: null, pocket: null, 'social-bookmarks': null,
  })
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogFocus(open, dialogRef)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  async function saveUrl() {
    if (!url.trim()) return
    setBusy(true); setMsg('Reading the page…')
    try {
      const res = await fetch('/api/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data.error || 'Could not save that URL. Check that it is a reachable http(s) page.')
        setBusy(false)
        return
      }
      if (!isString(data.bookmarkId)) {
        setMsg('The local import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      if (!isSavedContentStatus(data.status)) {
        setMsg('The local import API returned an unexpected status. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      if (!isOptionalBoolean(data.skipped) || !isOptionalBoolean(data.extracted) || !isOptionalString(data.message)) {
        setMsg('The local import API returned unexpected metadata. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const skipped = data.skipped ?? false
      const extracted = data.extracted ?? false
      const message = data.message
      if (!skipped && extracted) {
        setMsg('Summarizing with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      onSaved(data.bookmarkId, {
        kind: 'url',
        status: data.status,
        skipped,
        extracted,
        message,
      })
      reset()
    } catch {
      setMsg('Could not reach the local import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function saveNote() {
    if (!noteText.trim() && !noteTitle.trim()) return
    setBusy(true); setMsg('Saving…')
    try {
      const res = await fetch('/api/cards/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: noteTitle.trim(), text: noteText.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(data.error || 'Could not save the note. Check that Recall is still running, then try again.'); setBusy(false); return }
      if (!isString(data.id)) {
        setMsg('The local note API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      if (!isSavedContentStatus(data.status)) {
        setMsg('The local note API returned an unexpected status. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      if (noteText.trim()) fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      onSaved(data.id, { kind: 'note', status: data.status })
      reset()
    } catch {
      setMsg('Could not reach the local note API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function searchWiki() {
    if (!wikiQuery.trim() || busy) return
    setBusy(true); setMsg('Searching Wikipedia…'); setWikiResults([])
    try {
      const res = await fetch(`/api/import/wiki?query=${encodeURIComponent(wikiQuery.trim())}`)
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        setMsg(apiError(data, 'Could not search Wikipedia. Check the topic and try again.'))
        setBusy(false)
        return
      }
      if (!isWikiSearchResponse(data)) {
        setMsg('The local Wikipedia search API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      setWikiResults(data.results)
      setMsg(data.results.length > 0 ? `${data.results.length} topic ${data.results.length === 1 ? 'match' : 'matches'} found.` : 'No Wikipedia topics matched that search.')
      setBusy(false)
    } catch {
      setMsg('Could not reach the local Wikipedia search API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function saveWiki(title?: string) {
    const topic = (title ?? wikiQuery).trim()
    if (!topic || busy) return
    setBusy(true); setMsg('Importing Wikipedia topic…')
    try {
      const res = await fetch('/api/import/wiki', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: topic }),
      })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        setMsg(apiError(data, 'Could not import that Wikipedia topic. Check the topic and try again.'))
        setBusy(false)
        return
      }
      if (!isSavedContentResponse(data)) {
        setMsg('The local Wikipedia import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const skipped = data.skipped ?? false
      if (!skipped && data.extracted) {
        setMsg('Summarizing Wikipedia topic with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      onSaved(data.bookmarkId, {
        kind: 'wiki',
        status: data.status,
        skipped,
        extracted: data.extracted,
        message: data.message,
      })
      reset()
    } catch {
      setMsg('Could not reach the local Wikipedia import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function importFiles(kind: ImportKind) {
    const cfg = IMPORT_KINDS[kind]
    const files = selections[kind].files
    if (files.length === 0 || busy) return
    setBusy(true)
    setMsg(cfg.busyMessage ?? `Importing ${files.length} ${plural(cfg, files.length)}…`)
    setFailures(kind, [])
    try {
      const formData = new FormData()
      for (const file of files) formData.append('files', file)
      const res = await fetch(cfg.endpoint, { method: 'POST', body: formData })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        setFailures(kind, importFailures(data))
        setMsg(apiError(data, cfg.errorFallback))
        setBusy(false)
        return
      }
      if (!isImportResponse(data)) {
        setMsg(cfg.unexpectedMessage)
        setBusy(false)
        return
      }
      const importedCards = data.cards.filter(card =>
        !card.skipped && (cfg.countExtractedOnly ? card.extracted : true))
      if (data.failures.length > 0) setFailures(kind, data.failures)
      if (importedCards.length > 0) {
        setMsg(cfg.enrichMessage)
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      const firstCard = data.cards[0]
      onSaved(firstCard.id, {
        kind: cfg.savedKind,
        status: firstCard.status,
        extracted: cfg.extracted ?? firstCard.extracted,
        skipped: data.imported === 0 && data.skipped > 0,
        message: importMessage(cfg, data),
      })
      reset()
    } catch {
      setMsg(cfg.unreachableMessage)
      setBusy(false)
    }
  }

  function setFailures(kind: ImportKind, failures: ImportFailure[]) {
    setSelections(prev => ({ ...prev, [kind]: { ...prev[kind], failures } }))
  }

  function reset() {
    setBusy(false); setMsg(null); setUrl(''); setNoteTitle(''); setNoteText(''); setWikiQuery(''); setWikiResults([])
    setSelections(EMPTY_SELECTIONS)
    for (const input of Object.values(inputRefs.current)) {
      if (input) input.value = ''
    }
  }

  function setSelection(kind: ImportKind, files: FileList | File[]) {
    const cfg = IMPORT_KINDS[kind]
    const selected = Array.from(files).filter(cfg.matches).slice(0, cfg.max)
    setSelections(prev => ({ ...prev, [kind]: { files: selected, failures: [] } }))
    if (files.length > cfg.max) setMsg(cfg.tooManyMessage)
    else if (selected.length !== files.length) setMsg(cfg.wrongTypeMessage)
    else setMsg(null)
  }

  function clearSelection(kind: ImportKind) {
    setSelections(prev => ({ ...prev, [kind]: { files: [], failures: [] } }))
    setMsg(null)
    const input = inputRefs.current[kind]
    if (input) input.value = ''
  }

  function focusTab(next: AddContentTab) {
    setTab(next)
    window.setTimeout(() => document.getElementById(`add-source-tab-${next}`)?.focus(), 0)
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: AddContentTab) {
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

  const filePanel: FilePanelApi = {
    selections,
    busy,
    message: msg,
    registerInput: (kind, element) => { inputRefs.current[kind] = element },
    openPicker: kind => inputRefs.current[kind]?.click(),
    onSelect: setSelection,
    onClear: clearSelection,
    onImport: importFiles,
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-4 sm:pt-[8vh]"
      style={{ background: 'rgba(26,23,20,0.34)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        ref={dialogRef}
        className="rr-card w-full max-w-xl rr-rise"
        style={{ borderRadius: 4, maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-content-title"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 rr-rule">
          <h2 id="add-content-title" className="text-xl" style={{ fontWeight: 500 }}>Add to library</h2>
          <button className="rr-mono" onClick={() => !busy && onClose()} disabled={busy} aria-label="Close">esc</button>
        </div>

        {/* tabs */}
        <div className="flex gap-5 overflow-x-auto px-6 pt-3 pb-1" role="tablist" aria-label="Capture source">
          {TABS.map(t => (
            <button
              key={t.id}
              id={`add-source-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`add-source-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={e => onTabKeyDown(e, t.id)}
              className="rr-mono pb-2 shrink-0"
              style={{
                color: tab === t.id ? 'var(--accent)' : 'var(--sepia)',
                borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          id={`add-source-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`add-source-tab-${tab}`}
          className="px-6 py-5"
        >
          {tab === 'url' && (
            <div className="space-y-3">
              <p className="rr-prose" style={{ fontSize: '0.92rem' }}>
                Paste an article or media page. Recall extracts readable text when available,
                or saves media source metadata and a thumbnail when captions or local transcription are unavailable.
              </p>
              <input
                aria-label="Article URL"
                autoFocus
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !busy && saveUrl()}
                placeholder="https://…"
                disabled={busy}
                className="w-full bg-transparent px-3 py-2 outline-none rr-rule"
                style={{ borderBottom: '1px solid var(--hairline)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
              />
              <p className="rr-prose" style={{ fontSize: '0.84rem' }}>
                Private/local links are blocked. Use the PDF tab for local documents;
                use Image for local PNG/JPG/WebP capture. Use the Wiki tab for topic capture;
                use Import for browser bookmarks, Pocket CSV exports, or local Markdown files.
              </p>
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="rr-mono min-h-4">{msg}</span>
                <button className="rr-btn rr-btn-accent" disabled={busy || !url.trim()} onClick={saveUrl}>
                  {busy ? 'Working…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {tab === 'note' && (
            <div className="space-y-3">
              <input
                aria-label="Note title"
                autoFocus
                value={noteTitle}
                onChange={e => setNoteTitle(e.target.value)}
                placeholder="Note title (optional)"
                disabled={busy}
                className="w-full bg-transparent px-3 py-2 outline-none"
                style={{ borderBottom: '1px solid var(--hairline)', fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}
              />
              <textarea
                aria-label="Note body"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Write a thought, paste some text…"
                rows={6}
                disabled={busy}
                className="w-full bg-transparent px-3 py-2 outline-none rr-prose"
                style={{ borderBottom: '1px solid var(--hairline)', resize: 'vertical' }}
              />
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="rr-mono min-h-4">{msg}</span>
                <button className="rr-btn rr-btn-accent" disabled={busy || (!noteText.trim() && !noteTitle.trim())} onClick={saveNote}>
                  {busy ? 'Saving…' : 'Save note'}
                </button>
              </div>
            </div>
          )}

          {tab === 'wiki' && (
            <WikiPanel
              query={wikiQuery}
              results={wikiResults}
              busy={busy}
              message={msg}
              onQueryChange={setWikiQuery}
              onSearch={searchWiki}
              onImport={saveWiki}
            />
          )}
          {tab === 'pdf' && <FilePanel kinds={['pdf']} api={filePanel} />}
          {tab === 'image' && <FilePanel kinds={['image']} api={filePanel} />}
          {tab === 'import' && (
            <FilePanel
              kinds={IMPORT_TAB_KINDS}
              api={filePanel}
              intro="Import browser bookmark exports, Pocket CSV exports, Social Bookmarks Triage JSON, and Markdown archives as local cards."
            />
          )}
        </div>
      </div>
    </div>
  )
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSavedContentStatus(value: unknown): value is SavedContentStatus {
  return value === 'organizing' || value === 'summarizing' || value === 'ready' || value === 'failed'
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean'
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

type ImportCard = {
  id: string
  title: string
  status: SavedContentStatus
  extracted: boolean
  skipped?: boolean
  message?: string
}

type ImportFailure = {
  name: string
  error: string
  status: number
}

type ImportResponse = {
  ok: true
  cards: ImportCard[]
  failures: ImportFailure[]
  imported: number
  skipped: number
  failed: number
}

type WikiSearchResult = {
  title: string
  description: string
  url: string
}

type WikiSearchResponse = {
  ok: true
  results: WikiSearchResult[]
}

type SavedContentResponse = {
  bookmarkId: string
  title?: string
  status: SavedContentStatus
  extracted?: boolean
  skipped?: boolean
  message?: string
}

function isImportResponse(data: unknown): data is ImportResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.cards) &&
    record.cards.length > 0 &&
    record.cards.every(isImportCard) &&
    Array.isArray(record.failures) &&
    record.failures.every(isImportFailure) &&
    typeof record.imported === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.failed === 'number'
}

function isWikiSearchResponse(data: unknown): data is WikiSearchResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true && Array.isArray(record.results) && record.results.every(isWikiSearchResult)
}

function isWikiSearchResult(value: unknown): value is WikiSearchResult {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isString(record.title) && typeof record.description === 'string' && typeof record.url === 'string'
}

function isSavedContentResponse(data: unknown): data is SavedContentResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return isString(record.bookmarkId) &&
    isSavedContentStatus(record.status) &&
    isOptionalString(record.title) &&
    isOptionalBoolean(record.extracted) &&
    isOptionalBoolean(record.skipped) &&
    isOptionalString(record.message)
}

function isImportCard(value: unknown): value is ImportCard {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isString(record.id) &&
    typeof record.title === 'string' &&
    isSavedContentStatus(record.status) &&
    typeof record.extracted === 'boolean' &&
    isOptionalBoolean(record.skipped) &&
    isOptionalString(record.message)
}

function isImportFailure(value: unknown): value is ImportFailure {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' &&
    typeof record.error === 'string' &&
    typeof record.status === 'number'
}

function importFailures(data: unknown): ImportFailure[] {
  if (!data || typeof data !== 'object') return []
  const failures = (data as Record<string, unknown>).failures
  return Array.isArray(failures) ? failures.filter(isImportFailure) : []
}


function plural(cfg: ImportKindConfig, count: number): string {
  return count === 1 ? cfg.unit[0] : cfg.unit[1]
}

function importMessage(cfg: ImportKindConfig, data: ImportResponse): string {
  const { imported, skipped, failed } = data
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} ${plural(cfg, imported)} imported`)
  if (skipped > 0) parts.push(`${skipped} already in library`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (parts.length === 0) return `No ${cfg.unit[1]} were imported.`
  const suffix = cfg.messageSuffix
    ? cfg.messageSuffix(data)
    : imported > 0 ? 'Summarizing on your local model…' : ''
  return `${parts.join(' · ')}. ${suffix}`.trim()
}

function WikiPanel({
  query,
  results,
  busy,
  message,
  onQueryChange,
  onSearch,
  onImport,
}: {
  query: string
  results: WikiSearchResult[]
  busy: boolean
  message: string | null
  onQueryChange: (value: string) => void
  onSearch: () => void
  onImport: (title?: string) => void
}) {
  return (
    <div className="space-y-4" aria-live="polite">
      <p className="rr-prose" style={{ fontSize: '0.92rem' }}>
        Search for a movie, person, place, concept, or topic. Recall imports the matching Wikipedia page as local Reader text, then summarizes it with your local model.
      </p>
      <label className="block">
        <span className="rr-mono">Wiki topic</span>
        <input
          aria-label="Wiki topic search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && !busy && onSearch()}
          disabled={busy}
          placeholder="Search movies, people, places, and things"
          className="mt-2 w-full bg-transparent px-3 py-2 outline-none rr-rule"
          style={{ borderBottom: '1px solid var(--hairline)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
        />
      </label>
      {results.length > 0 && (
        <div className="grid gap-2" aria-label="Wikipedia topic results">
          {results.map(result => (
            <button
              key={`${result.title}-${result.url}`}
              type="button"
              className="rr-card px-4 py-3 text-left"
              style={{ borderRadius: 3 }}
              disabled={busy}
              onClick={() => onImport(result.title)}
              aria-label={`Import Wikipedia topic ${result.title}`}
              title={`Import ${result.title} from Wikipedia`}
            >
              <span className="font-display block" style={{ fontSize: '1rem' }}>{result.title}</span>
              <span className="rr-prose mt-1 block" style={{ fontSize: '0.88rem' }}>
                {result.description || result.url}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="rr-mono min-h-4">{message}</span>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button
            className="rr-btn"
            disabled={busy || !query.trim()}
            onClick={onSearch}
            type="button"
          >
            {busy ? 'Working…' : 'Search wiki'}
          </button>
          <button
            className="rr-btn rr-btn-accent"
            disabled={busy || !query.trim()}
            onClick={() => onImport()}
            type="button"
          >
            {busy ? 'Importing…' : 'Import topic'}
          </button>
        </div>
      </div>
    </div>
  )
}

type FilePanelApi = {
  selections: Record<ImportKind, Selection>
  busy: boolean
  message: string | null
  registerInput: (kind: ImportKind, element: HTMLInputElement | null) => void
  openPicker: (kind: ImportKind) => void
  onSelect: (kind: ImportKind, files: FileList | File[]) => void
  onClear: (kind: ImportKind) => void
  onImport: (kind: ImportKind) => void
}

function FilePanel({ kinds, api, intro }: { kinds: ImportKind[]; api: FilePanelApi; intro?: string }) {
  return (
    <div className="space-y-4" aria-live="polite">
      {intro && <p className="rr-prose" style={{ fontSize: '0.92rem' }}>{intro}</p>}
      {kinds.map(kind => <ImportSection key={kind} kind={kind} api={api} />)}
      <div className="flex flex-col gap-2 pt-1 lg:flex-row lg:items-center lg:justify-between">
        <span className="rr-mono min-h-4">{api.message}</span>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {kinds.map((kind, index) => (
            <button
              key={kind}
              className={index === kinds.length - 1 ? 'rr-btn rr-btn-accent' : 'rr-btn'}
              disabled={api.busy || api.selections[kind].files.length === 0}
              onClick={() => api.onImport(kind)}
              type="button"
            >
              {api.busy ? 'Importing…' : IMPORT_KINDS[kind].importLabel}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ImportSection({ kind, api }: { kind: ImportKind; api: FilePanelApi }) {
  const cfg = IMPORT_KINDS[kind]
  const { files, failures } = api.selections[kind]
  const Icon = cfg.icon
  const multiple = cfg.max > 1

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (api.busy) return
    api.onSelect(kind, event.dataTransfer.files)
  }

  return (
    <>
      <div
        className={`rr-card flex flex-col items-center justify-center px-4 text-center ${cfg.tall ? 'min-h-36 py-6' : 'min-h-32 py-5'}`}
        style={{ borderRadius: 3, borderStyle: 'dashed' }}
        onDragOver={event => event.preventDefault()}
        onDrop={onDrop}
      >
        <Icon size={22} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <p className="font-display mt-3" style={{ fontSize: '1.05rem' }}>{cfg.dropTitle}</p>
        <p className="rr-prose mt-1" style={{ fontSize: '0.9rem' }}>{cfg.dropHelp}</p>
        <input
          ref={element => api.registerInput(kind, element)}
          type="file"
          accept={cfg.accept}
          multiple={multiple}
          className="sr-only"
          aria-label={cfg.chooseAria}
          onChange={event => {
            if (event.currentTarget.files) api.onSelect(kind, event.currentTarget.files)
          }}
        />
        <button
          className="rr-btn mt-4"
          disabled={api.busy}
          aria-label={cfg.chooseAria}
          title={cfg.chooseTitle}
          onClick={() => api.openPicker(kind)}
          type="button"
        >
          {cfg.chooseLabel}
        </button>
      </div>
      {files.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <div className="flex items-center justify-between gap-3">
            <p className="rr-mono">{files.length} selected {cfg.selectedNoun ?? plural(cfg, files.length)}</p>
            <button className="rr-link rr-mono" type="button" onClick={() => api.onClear(kind)} disabled={api.busy}>Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" aria-label={`Selected ${cfg.fileNoun} files`}>
            {files.map(file => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="rr-tag">
                {file.name} · {formatFileSize(file.size)}
              </span>
            ))}
          </div>
        </div>
      )}
      {failures.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>{cfg.issuesLabel} import issues</p>
          <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.9rem' }}>
            {failures.map(failure => (
              <li key={`${failure.name}-${failure.error}`}>{failure.name}: {failure.error}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

