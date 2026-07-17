'use client'

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BookOpen, FileArchive, FileJson, FileText, Image as ImageIcon, Upload } from 'lucide-react'
import { useDialogFocus } from '@/lib/use-dialog-focus'

export type AddContentTab = 'url' | 'note' | 'wiki' | 'pdf' | 'image' | 'import'
type SavedContentStatus = 'organizing' | 'summarizing' | 'ready' | 'failed'

export interface SavedContentMeta {
  kind: 'url' | 'note' | 'wiki' | 'pdf' | 'image' | 'markdown' | 'bookmarks' | 'pocket' | 'social-bookmarks'
  status: SavedContentStatus
  skipped?: boolean
  extracted?: boolean
  message?: string
}

const TABS: { id: AddContentTab; label: string; ready: boolean }[] = [
  { id: 'url', label: 'URL', ready: true },
  { id: 'wiki', label: 'Wiki', ready: true },
  { id: 'pdf', label: 'PDF', ready: true },
  { id: 'image', label: 'Image', ready: true },
  { id: 'import', label: 'Import', ready: true },
  { id: 'note', label: 'Note', ready: true },
]

const MAX_PDF_IMPORT_FILES = 10
const MAX_IMAGE_IMPORT_FILES = 10
const MAX_MARKDOWN_IMPORT_FILES = 10
const MAX_BOOKMARK_IMPORT_FILES = 1
const MAX_POCKET_IMPORT_FILES = 1
const MAX_SOCIAL_BOOKMARKS_IMPORT_FILES = 1

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
  const [pdfFiles, setPdfFiles] = useState<File[]>([])
  const [pdfFailures, setPdfFailures] = useState<PdfImportFailure[]>([])
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imageFailures, setImageFailures] = useState<ImageImportFailure[]>([])
  const [markdownFiles, setMarkdownFiles] = useState<File[]>([])
  const [markdownFailures, setMarkdownFailures] = useState<MarkdownImportFailure[]>([])
  const [bookmarkFiles, setBookmarkFiles] = useState<File[]>([])
  const [bookmarkFailures, setBookmarkFailures] = useState<BookmarkImportFailure[]>([])
  const [pocketFiles, setPocketFiles] = useState<File[]>([])
  const [pocketFailures, setPocketFailures] = useState<PocketImportFailure[]>([])
  const [socialBookmarkFiles, setSocialBookmarkFiles] = useState<File[]>([])
  const [socialBookmarkFailures, setSocialBookmarkFailures] = useState<SocialBookmarksImportFailure[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const markdownInputRef = useRef<HTMLInputElement | null>(null)
  const bookmarkInputRef = useRef<HTMLInputElement | null>(null)
  const pocketInputRef = useRef<HTMLInputElement | null>(null)
  const socialBookmarksInputRef = useRef<HTMLInputElement | null>(null)
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

  async function savePdfs() {
    if (pdfFiles.length === 0 || busy) return
    setBusy(true); setMsg(`Importing ${pdfFiles.length} ${pdfFiles.length === 1 ? 'PDF' : 'PDFs'}…`); setPdfFailures([])
    try {
      const formData = new FormData()
      for (const file of pdfFiles) formData.append('files', file)
      const res = await fetch('/api/import/pdf', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        const failures = pdfImportFailures(data)
        setPdfFailures(failures)
        setMsg(apiError(data, 'Could not import those PDFs. Check that they contain selectable text.'))
        setBusy(false)
        return
      }
      if (!isPdfImportResponse(data)) {
        setMsg('The local PDF import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const importedCards = data.cards.filter(card => !card.skipped)
      if (data.failures.length > 0) {
        setPdfFailures(data.failures)
      }
      if (importedCards.length > 0) {
        setMsg('Summarizing PDFs with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      const firstCard = data.cards[0]
      onSaved(firstCard.id, {
        kind: 'pdf',
        status: firstCard.status,
        extracted: true,
        skipped: data.imported === 0 && data.skipped > 0,
        message: pdfImportMessage(data),
      })
      reset()
    } catch {
      setMsg('Could not reach the local PDF import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function saveImages() {
    if (imageFiles.length === 0 || busy) return
    setBusy(true); setMsg(`Importing ${imageFiles.length} ${imageFiles.length === 1 ? 'image' : 'images'}…`); setImageFailures([])
    try {
      const formData = new FormData()
      for (const file of imageFiles) formData.append('files', file)
      const res = await fetch('/api/import/image', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        const failures = imageImportFailures(data)
        setImageFailures(failures)
        setMsg(apiError(data, 'Could not import those images. Use PNG, JPG, or WebP files.'))
        setBusy(false)
        return
      }
      if (!isImageImportResponse(data)) {
        setMsg('The local image import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const importedCards = data.cards.filter(card => !card.skipped && card.extracted)
      if (data.failures.length > 0) {
        setImageFailures(data.failures)
      }
      if (importedCards.length > 0) {
        setMsg('Summarizing images with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      const firstCard = data.cards[0]
      onSaved(firstCard.id, {
        kind: 'image',
        status: firstCard.status,
        extracted: firstCard.extracted,
        skipped: data.imported === 0 && data.skipped > 0,
        message: imageImportMessage(data),
      })
      reset()
    } catch {
      setMsg('Could not reach the local image import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function saveMarkdownFiles() {
    if (markdownFiles.length === 0 || busy) return
    setBusy(true); setMsg(`Importing ${markdownFiles.length} Markdown ${markdownFiles.length === 1 ? 'file' : 'files'}…`); setMarkdownFailures([])
    try {
      const formData = new FormData()
      for (const file of markdownFiles) formData.append('files', file)
      const res = await fetch('/api/import/markdown', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        const failures = markdownImportFailures(data)
        setMarkdownFailures(failures)
        setMsg(apiError(data, 'Could not import those Markdown files. Use .md or .markdown files.'))
        setBusy(false)
        return
      }
      if (!isMarkdownImportResponse(data)) {
        setMsg('The local Markdown import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const importedCards = data.cards.filter(card => !card.skipped)
      if (data.failures.length > 0) {
        setMarkdownFailures(data.failures)
      }
      if (importedCards.length > 0) {
        setMsg('Summarizing Markdown files with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      const firstCard = data.cards[0]
      onSaved(firstCard.id, {
        kind: 'markdown',
        status: firstCard.status,
        extracted: true,
        skipped: data.imported === 0 && data.skipped > 0,
        message: markdownImportMessage(data),
      })
      reset()
    } catch {
      setMsg('Could not reach the local Markdown import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function saveBookmarkFile() {
    if (bookmarkFiles.length === 0 || busy) return
    setBusy(true); setMsg('Importing browser bookmarks…'); setBookmarkFailures([])
    try {
      const formData = new FormData()
      for (const file of bookmarkFiles) formData.append('files', file)
      const res = await fetch('/api/import/bookmarks', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        const failures = bookmarkImportFailures(data)
        setBookmarkFailures(failures)
        setMsg(apiError(data, 'Could not import that browser bookmarks export. Use a Chrome, Firefox, or Edge HTML export.'))
        setBusy(false)
        return
      }
      if (!isBookmarkImportResponse(data)) {
        setMsg('The local browser bookmarks import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const importedCards = data.cards.filter(card => !card.skipped)
      if (data.failures.length > 0) {
        setBookmarkFailures(data.failures)
      }
      if (importedCards.length > 0) {
        setMsg('Summarizing imported bookmarks with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      const firstCard = data.cards[0]
      onSaved(firstCard.id, {
        kind: 'bookmarks',
        status: firstCard.status,
        extracted: false,
        skipped: data.imported === 0 && data.skipped > 0,
        message: bookmarkImportMessage(data),
      })
      reset()
    } catch {
      setMsg('Could not reach the local browser bookmarks import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function savePocketFile() {
    if (pocketFiles.length === 0 || busy) return
    setBusy(true); setMsg('Importing Pocket links…'); setPocketFailures([])
    try {
      const formData = new FormData()
      for (const file of pocketFiles) formData.append('files', file)
      const res = await fetch('/api/import/pocket', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        const failures = pocketImportFailures(data)
        setPocketFailures(failures)
        setMsg(apiError(data, 'Could not import that Pocket CSV export. Use a Pocket CSV file with URL and title columns.'))
        setBusy(false)
        return
      }
      if (!isPocketImportResponse(data)) {
        setMsg('The local Pocket import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const importedCards = data.cards.filter(card => !card.skipped)
      if (data.failures.length > 0) {
        setPocketFailures(data.failures)
      }
      if (importedCards.length > 0) {
        setMsg('Summarizing imported Pocket links with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      const firstCard = data.cards[0]
      onSaved(firstCard.id, {
        kind: 'pocket',
        status: firstCard.status,
        extracted: false,
        skipped: data.imported === 0 && data.skipped > 0,
        message: pocketImportMessage(data),
      })
      reset()
    } catch {
      setMsg('Could not reach the local Pocket import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  async function saveSocialBookmarksFile() {
    if (socialBookmarkFiles.length === 0 || busy) return
    setBusy(true); setMsg('Importing Social Bookmarks…'); setSocialBookmarkFailures([])
    try {
      const formData = new FormData()
      for (const file of socialBookmarkFiles) formData.append('files', file)
      const res = await fetch('/api/import/social-bookmarks', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok) {
        const failures = socialBookmarksImportFailures(data)
        setSocialBookmarkFailures(failures)
        setMsg(apiError(data, 'Could not import that Social Bookmarks Triage JSON export. Use a JSON export or bookmarklet file.'))
        setBusy(false)
        return
      }
      if (!isSocialBookmarksImportResponse(data)) {
        setMsg('The local Social Bookmarks import API returned an unexpected response. Try again, or restart Recall.')
        setBusy(false)
        return
      }
      const importedCards = data.cards.filter(card => !card.skipped)
      if (data.failures.length > 0) {
        setSocialBookmarkFailures(data.failures)
      }
      if (importedCards.length > 0) {
        setMsg('Summarizing imported Social Bookmarks with the local model…')
        fetch('/api/enrich', { method: 'POST' }).catch(() => {})
      }
      const firstCard = data.cards[0]
      onSaved(firstCard.id, {
        kind: 'social-bookmarks',
        status: firstCard.status,
        extracted: true,
        skipped: data.imported === 0 && data.skipped > 0,
        message: socialBookmarksImportMessage(data),
      })
      reset()
    } catch {
      setMsg('Could not reach the local Social Bookmarks import API. Check that Recall is still running, then try again.')
      setBusy(false)
    }
  }

  function reset() {
    setBusy(false); setMsg(null); setUrl(''); setNoteTitle(''); setNoteText(''); setWikiQuery(''); setWikiResults([]); setPdfFiles([]); setPdfFailures([]); setImageFiles([]); setImageFailures([]); setMarkdownFiles([]); setMarkdownFailures([]); setBookmarkFiles([]); setBookmarkFailures([]); setPocketFiles([]); setPocketFailures([]); setSocialBookmarkFiles([]); setSocialBookmarkFailures([])
    if (pdfInputRef.current) pdfInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
    if (markdownInputRef.current) markdownInputRef.current.value = ''
    if (bookmarkInputRef.current) bookmarkInputRef.current.value = ''
    if (pocketInputRef.current) pocketInputRef.current.value = ''
    if (socialBookmarksInputRef.current) socialBookmarksInputRef.current.value = ''
  }

  function setPdfSelection(files: FileList | File[]) {
    const selected = Array.from(files).filter(file => isPdfFile(file)).slice(0, MAX_PDF_IMPORT_FILES)
    setPdfFiles(selected)
    setPdfFailures([])
    if (files.length > MAX_PDF_IMPORT_FILES) {
      setMsg(`Import up to ${MAX_PDF_IMPORT_FILES} PDFs at a time.`)
    } else if (selected.length !== files.length) {
      setMsg('Only PDF files can be imported from this panel.')
    } else {
      setMsg(null)
    }
  }

  function onPdfDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (busy) return
    setPdfSelection(event.dataTransfer.files)
  }

  function setImageSelection(files: FileList | File[]) {
    const selected = Array.from(files).filter(file => isImageFile(file)).slice(0, MAX_IMAGE_IMPORT_FILES)
    setImageFiles(selected)
    setImageFailures([])
    if (files.length > MAX_IMAGE_IMPORT_FILES) {
      setMsg(`Import up to ${MAX_IMAGE_IMPORT_FILES} images at a time.`)
    } else if (selected.length !== files.length) {
      setMsg('Only PNG, JPG, or WebP images can be imported from this panel.')
    } else {
      setMsg(null)
    }
  }

  function onImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (busy) return
    setImageSelection(event.dataTransfer.files)
  }

  function setMarkdownSelection(files: FileList | File[]) {
    const selected = Array.from(files).filter(file => isMarkdownFile(file)).slice(0, MAX_MARKDOWN_IMPORT_FILES)
    setMarkdownFiles(selected)
    setMarkdownFailures([])
    if (files.length > MAX_MARKDOWN_IMPORT_FILES) {
      setMsg(`Import up to ${MAX_MARKDOWN_IMPORT_FILES} Markdown files at a time.`)
    } else if (selected.length !== files.length) {
      setMsg('Only .md or .markdown files can be imported from this panel.')
    } else {
      setMsg(null)
    }
  }

  function onMarkdownDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (busy) return
    setMarkdownSelection(event.dataTransfer.files)
  }

  function setBookmarkSelection(files: FileList | File[]) {
    const selected = Array.from(files).filter(file => isBookmarkHtmlFile(file)).slice(0, MAX_BOOKMARK_IMPORT_FILES)
    setBookmarkFiles(selected)
    setBookmarkFailures([])
    if (files.length > MAX_BOOKMARK_IMPORT_FILES) {
      setMsg('Import one browser bookmarks export at a time.')
    } else if (selected.length !== files.length) {
      setMsg('Only browser bookmark HTML exports can be imported from this panel.')
    } else {
      setMsg(null)
    }
  }

  function onBookmarkDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (busy) return
    setBookmarkSelection(event.dataTransfer.files)
  }

  function setPocketSelection(files: FileList | File[]) {
    const selected = Array.from(files).filter(file => isPocketCsvFile(file)).slice(0, MAX_POCKET_IMPORT_FILES)
    setPocketFiles(selected)
    setPocketFailures([])
    if (files.length > MAX_POCKET_IMPORT_FILES) {
      setMsg('Import one Pocket CSV export at a time.')
    } else if (selected.length !== files.length) {
      setMsg('Only Pocket CSV exports can be imported from this panel.')
    } else {
      setMsg(null)
    }
  }

  function onPocketDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (busy) return
    setPocketSelection(event.dataTransfer.files)
  }

  function setSocialBookmarksSelection(files: FileList | File[]) {
    const selected = Array.from(files).filter(file => isSocialBookmarksJsonFile(file)).slice(0, MAX_SOCIAL_BOOKMARKS_IMPORT_FILES)
    setSocialBookmarkFiles(selected)
    setSocialBookmarkFailures([])
    if (files.length > MAX_SOCIAL_BOOKMARKS_IMPORT_FILES) {
      setMsg('Import one Social Bookmarks Triage JSON export at a time.')
    } else if (selected.length !== files.length) {
      setMsg('Only Social Bookmarks Triage JSON exports can be imported from this panel.')
    } else {
      setMsg(null)
    }
  }

  function onSocialBookmarksDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (busy) return
    setSocialBookmarksSelection(event.dataTransfer.files)
  }

  function focusTab(next: AddContentTab) {
    setTab(next)
    window.setTimeout(() => document.getElementById(addTabId(next))?.focus(), 0)
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
              id={addTabId(t.id)}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={addPanelId(t.id)}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={e => onTabKeyDown(e, t.id)}
              className="rr-mono pb-2 shrink-0"
              style={{
                color: tab === t.id ? 'var(--accent)' : t.ready ? 'var(--sepia)' : 'var(--sepia-2)',
                borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                opacity: t.ready ? 1 : 0.5,
                cursor: 'pointer',
              }}
              title={t.ready ? '' : `${t.label} capture is planned`}
            >
              {t.label}{!t.ready && ' ·'}
            </button>
          ))}
        </div>

        <div
          id={addPanelId(tab)}
          role="tabpanel"
          aria-labelledby={addTabId(tab)}
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
              <DefaultActionSelect />
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
              <DefaultActionSelect />
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
          {tab === 'pdf' && (
            <PdfPanel
              files={pdfFiles}
              failures={pdfFailures}
              busy={busy}
              message={msg}
              inputRef={pdfInputRef}
              onSelect={setPdfSelection}
              onDrop={onPdfDrop}
              onImport={savePdfs}
              onClear={() => {
                setPdfFiles([])
                setPdfFailures([])
                setMsg(null)
                if (pdfInputRef.current) pdfInputRef.current.value = ''
              }}
            />
          )}
          {tab === 'image' && (
            <ImagePanel
              files={imageFiles}
              failures={imageFailures}
              busy={busy}
              message={msg}
              inputRef={imageInputRef}
              onSelect={setImageSelection}
              onDrop={onImageDrop}
              onImport={saveImages}
              onClear={() => {
                setImageFiles([])
                setImageFailures([])
                setMsg(null)
                if (imageInputRef.current) imageInputRef.current.value = ''
              }}
            />
          )}
          {tab === 'import' && (
            <ImportPanel
              markdownFiles={markdownFiles}
              markdownFailures={markdownFailures}
              bookmarkFiles={bookmarkFiles}
              bookmarkFailures={bookmarkFailures}
              pocketFiles={pocketFiles}
              pocketFailures={pocketFailures}
              socialBookmarkFiles={socialBookmarkFiles}
              socialBookmarkFailures={socialBookmarkFailures}
              busy={busy}
              message={msg}
              markdownInputRef={markdownInputRef}
              bookmarkInputRef={bookmarkInputRef}
              pocketInputRef={pocketInputRef}
              socialBookmarksInputRef={socialBookmarksInputRef}
              onSelectMarkdown={setMarkdownSelection}
              onDropMarkdown={onMarkdownDrop}
              onImportMarkdown={saveMarkdownFiles}
              onClearMarkdown={() => {
                setMarkdownFiles([])
                setMarkdownFailures([])
                setMsg(null)
                if (markdownInputRef.current) markdownInputRef.current.value = ''
              }}
              onSelectBookmarks={setBookmarkSelection}
              onDropBookmarks={onBookmarkDrop}
              onImportBookmarks={saveBookmarkFile}
              onClearBookmarks={() => {
                setBookmarkFiles([])
                setBookmarkFailures([])
                setMsg(null)
                if (bookmarkInputRef.current) bookmarkInputRef.current.value = ''
              }}
              onSelectPocket={setPocketSelection}
              onDropPocket={onPocketDrop}
              onImportPocket={savePocketFile}
              onClearPocket={() => {
                setPocketFiles([])
                setPocketFailures([])
                setMsg(null)
                if (pocketInputRef.current) pocketInputRef.current.value = ''
              }}
              onSelectSocialBookmarks={setSocialBookmarksSelection}
              onDropSocialBookmarks={onSocialBookmarksDrop}
              onImportSocialBookmarks={saveSocialBookmarksFile}
              onClearSocialBookmarks={() => {
                setSocialBookmarkFiles([])
                setSocialBookmarkFailures([])
                setMsg(null)
                if (socialBookmarksInputRef.current) socialBookmarksInputRef.current.value = ''
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function addTabId(tab: AddContentTab): string {
  return `add-source-tab-${tab}`
}

function addPanelId(tab: AddContentTab): string {
  return `add-source-panel-${tab}`
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

type PdfImportCard = {
  id: string
  title: string
  status: SavedContentStatus
  extracted: boolean
  skipped?: boolean
  message?: string
}

type PdfImportFailure = {
  name: string
  error: string
  status: number
}

type PdfImportResponse = {
  ok: true
  cards: PdfImportCard[]
  failures: PdfImportFailure[]
  imported: number
  skipped: number
  failed: number
}

type ImageImportCard = PdfImportCard
type ImageImportFailure = PdfImportFailure
type ImageImportResponse = {
  ok: true
  cards: ImageImportCard[]
  failures: ImageImportFailure[]
  imported: number
  skipped: number
  failed: number
}

type MarkdownImportCard = PdfImportCard
type MarkdownImportFailure = PdfImportFailure
type MarkdownImportResponse = {
  ok: true
  cards: MarkdownImportCard[]
  failures: MarkdownImportFailure[]
  imported: number
  skipped: number
  failed: number
}

type BookmarkImportCard = PdfImportCard
type BookmarkImportFailure = PdfImportFailure
type BookmarkImportResponse = {
  ok: true
  cards: BookmarkImportCard[]
  failures: BookmarkImportFailure[]
  imported: number
  skipped: number
  failed: number
}

type PocketImportCard = PdfImportCard
type PocketImportFailure = PdfImportFailure
type PocketImportResponse = {
  ok: true
  cards: PocketImportCard[]
  failures: PocketImportFailure[]
  imported: number
  skipped: number
  failed: number
}

type SocialBookmarksImportCard = PdfImportCard
type SocialBookmarksImportFailure = PdfImportFailure
type SocialBookmarksImportResponse = {
  ok: true
  cards: SocialBookmarksImportCard[]
  failures: SocialBookmarksImportFailure[]
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

function isPdfFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type === 'application/pdf' || extension === 'pdf'
}

function isImageFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/webp' ||
    extension === 'png' ||
    extension === 'jpg' ||
    extension === 'jpeg' ||
    extension === 'webp'
}

function isMarkdownFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'md' ||
    extension === 'markdown' ||
    file.type === 'text/markdown' ||
    file.type === 'text/x-markdown'
}

function isBookmarkHtmlFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'html' ||
    extension === 'htm' ||
    file.type === 'text/html' ||
    file.type === 'application/octet-stream'
}

function isPocketCsvFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'csv' ||
    file.type === 'text/csv' ||
    file.type === 'application/csv' ||
    file.type === 'application/vnd.ms-excel' ||
    file.type === 'application/octet-stream'
}

function isSocialBookmarksJsonFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'json' ||
    file.type === 'application/json' ||
    file.type === 'application/octet-stream'
}

function isPdfImportResponse(data: unknown): data is PdfImportResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.cards) &&
    record.cards.length > 0 &&
    record.cards.every(isPdfImportCard) &&
    Array.isArray(record.failures) &&
    record.failures.every(isPdfImportFailure) &&
    typeof record.imported === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.failed === 'number'
}

function isImageImportResponse(data: unknown): data is ImageImportResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.cards) &&
    record.cards.length > 0 &&
    record.cards.every(isPdfImportCard) &&
    Array.isArray(record.failures) &&
    record.failures.every(isPdfImportFailure) &&
    typeof record.imported === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.failed === 'number'
}

function isMarkdownImportResponse(data: unknown): data is MarkdownImportResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.cards) &&
    record.cards.length > 0 &&
    record.cards.every(isPdfImportCard) &&
    Array.isArray(record.failures) &&
    record.failures.every(isPdfImportFailure) &&
    typeof record.imported === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.failed === 'number'
}

function isBookmarkImportResponse(data: unknown): data is BookmarkImportResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.cards) &&
    record.cards.length > 0 &&
    record.cards.every(isPdfImportCard) &&
    Array.isArray(record.failures) &&
    record.failures.every(isPdfImportFailure) &&
    typeof record.imported === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.failed === 'number'
}

function isPocketImportResponse(data: unknown): data is PocketImportResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.cards) &&
    record.cards.length > 0 &&
    record.cards.every(isPdfImportCard) &&
    Array.isArray(record.failures) &&
    record.failures.every(isPdfImportFailure) &&
    typeof record.imported === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.failed === 'number'
}

function isSocialBookmarksImportResponse(data: unknown): data is SocialBookmarksImportResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.cards) &&
    record.cards.length > 0 &&
    record.cards.every(isPdfImportCard) &&
    Array.isArray(record.failures) &&
    record.failures.every(isPdfImportFailure) &&
    typeof record.imported === 'number' &&
    typeof record.skipped === 'number' &&
    typeof record.failed === 'number'
}

function isWikiSearchResponse(data: unknown): data is WikiSearchResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.ok === true &&
    Array.isArray(record.results) &&
    record.results.every(isWikiSearchResult)
}

function isWikiSearchResult(value: unknown): value is WikiSearchResult {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.title === 'string' &&
    typeof record.description === 'string' &&
    typeof record.url === 'string'
}

function isSavedContentResponse(data: unknown): data is SavedContentResponse {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return isString(record.bookmarkId) &&
    isSavedContentStatus(record.status) &&
    isOptionalBoolean(record.extracted) &&
    isOptionalBoolean(record.skipped) &&
    isOptionalString(record.message) &&
    isOptionalString(record.title)
}

function isPdfImportCard(value: unknown): value is PdfImportCard {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isString(record.id) &&
    typeof record.title === 'string' &&
    isSavedContentStatus(record.status) &&
    typeof record.extracted === 'boolean' &&
    isOptionalBoolean(record.skipped) &&
    isOptionalString(record.message)
}

function isPdfImportFailure(value: unknown): value is PdfImportFailure {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' &&
    typeof record.error === 'string' &&
    typeof record.status === 'number'
}

function pdfImportFailures(data: unknown): PdfImportFailure[] {
  if (!data || typeof data !== 'object') return []
  const failures = (data as Record<string, unknown>).failures
  return Array.isArray(failures) ? failures.filter(isPdfImportFailure) : []
}

function imageImportFailures(data: unknown): ImageImportFailure[] {
  return pdfImportFailures(data)
}

function markdownImportFailures(data: unknown): MarkdownImportFailure[] {
  return pdfImportFailures(data)
}

function bookmarkImportFailures(data: unknown): BookmarkImportFailure[] {
  return pdfImportFailures(data)
}

function pocketImportFailures(data: unknown): PocketImportFailure[] {
  return pdfImportFailures(data)
}

function socialBookmarksImportFailures(data: unknown): SocialBookmarksImportFailure[] {
  return pdfImportFailures(data)
}

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error
  }
  return fallback
}

function pdfImportMessage(data: PdfImportResponse): string {
  const imported = data.imported
  const skipped = data.skipped
  const failed = data.failed
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} ${imported === 1 ? 'PDF' : 'PDFs'} imported`)
  if (skipped > 0) parts.push(`${skipped} already in library`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (parts.length === 0) return 'No PDFs were imported.'
  return `${parts.join(' · ')}. ${imported > 0 ? 'Summarizing on your local model…' : ''}`.trim()
}

function imageImportMessage(data: ImageImportResponse): string {
  const imported = data.imported
  const skipped = data.skipped
  const failed = data.failed
  const extracted = data.cards.filter(card => !card.skipped && card.extracted).length
  const savedWithoutText = data.cards.filter(card => !card.skipped && !card.extracted).length
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} ${imported === 1 ? 'image' : 'images'} imported`)
  if (skipped > 0) parts.push(`${skipped} already in library`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (parts.length === 0) return 'No images were imported.'
  const suffix = extracted > 0
    ? 'Summarizing OCR/vision text on your local model…'
    : savedWithoutText > 0
      ? 'Saved locally; OCR/vision is unavailable.'
      : ''
  return `${parts.join(' · ')}. ${suffix}`.trim()
}

function markdownImportMessage(data: MarkdownImportResponse): string {
  const imported = data.imported
  const skipped = data.skipped
  const failed = data.failed
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} Markdown ${imported === 1 ? 'file' : 'files'} imported`)
  if (skipped > 0) parts.push(`${skipped} already in library`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (parts.length === 0) return 'No Markdown files were imported.'
  return `${parts.join(' · ')}. ${imported > 0 ? 'Summarizing on your local model…' : ''}`.trim()
}

function bookmarkImportMessage(data: BookmarkImportResponse): string {
  const imported = data.imported
  const skipped = data.skipped
  const failed = data.failed
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} browser ${imported === 1 ? 'bookmark' : 'bookmarks'} imported`)
  if (skipped > 0) parts.push(`${skipped} already in library`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (parts.length === 0) return 'No browser bookmarks were imported.'
  return `${parts.join(' · ')}. ${imported > 0 ? 'Summarizing on your local model…' : ''}`.trim()
}

function pocketImportMessage(data: PocketImportResponse): string {
  const imported = data.imported
  const skipped = data.skipped
  const failed = data.failed
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} Pocket ${imported === 1 ? 'link' : 'links'} imported`)
  if (skipped > 0) parts.push(`${skipped} already in library`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (parts.length === 0) return 'No Pocket links were imported.'
  return `${parts.join(' · ')}. ${imported > 0 ? 'Summarizing on your local model…' : ''}`.trim()
}

function socialBookmarksImportMessage(data: SocialBookmarksImportResponse): string {
  const imported = data.imported
  const skipped = data.skipped
  const failed = data.failed
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} Social Bookmarks ${imported === 1 ? 'item' : 'items'} imported`)
  if (skipped > 0) parts.push(`${skipped} already in library`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (parts.length === 0) return 'No Social Bookmarks items were imported.'
  return `${parts.join(' · ')}. ${imported > 0 ? 'Summarizing on your local model…' : ''}`.trim()
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
      <DefaultActionSelect />
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

function PdfPanel({
  files,
  failures,
  busy,
  message,
  inputRef,
  onSelect,
  onDrop,
  onImport,
  onClear,
}: {
  files: File[]
  failures: PdfImportFailure[]
  busy: boolean
  message: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onSelect: (files: FileList | File[]) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onImport: () => void
  onClear: () => void
}) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div
        className="rr-card flex min-h-36 flex-col items-center justify-center px-4 py-6 text-center"
        style={{ borderRadius: 3, borderStyle: 'dashed' }}
        onDragOver={event => event.preventDefault()}
        onDrop={onDrop}
      >
        <Upload size={22} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <p className="font-display mt-3" style={{ fontSize: '1.05rem' }}>Drop PDFs here</p>
        <p className="rr-prose mt-1" style={{ fontSize: '0.9rem' }}>Choose up to 10 PDFs. Selectable text imports directly; scanned PDFs use local OCR/vision.</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="sr-only"
          aria-label="Choose PDF files"
          onChange={event => {
            if (event.currentTarget.files) onSelect(event.currentTarget.files)
          }}
        />
        <button
          className="rr-btn mt-4"
          disabled={busy}
          aria-label="Choose PDF files"
          title="Choose up to 10 PDFs to save as local document cards."
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          Choose PDFs
        </button>
      </div>
      {files.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <div className="flex items-center justify-between gap-3">
            <p className="rr-mono">{files.length} selected {files.length === 1 ? 'PDF' : 'PDFs'}</p>
            <button className="rr-link rr-mono" type="button" onClick={onClear} disabled={busy}>Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected PDF files">
            {files.map(file => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="rr-tag">
                {file.name} · {formatFileSize(file.size)}
              </span>
            ))}
          </div>
        </div>
      )}
      <DefaultActionSelect />
      {failures.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>PDF import issues</p>
          <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.9rem' }}>
            {failures.map(failure => (
              <li key={`${failure.name}-${failure.error}`}>{failure.name}: {failure.error}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="rr-mono min-h-4">{message}</span>
        <button
          className="rr-btn rr-btn-accent"
          disabled={busy || files.length === 0}
          onClick={onImport}
          type="button"
        >
          {busy ? 'Importing…' : 'Import PDFs'}
        </button>
      </div>
    </div>
  )
}

function ImagePanel({
  files,
  failures,
  busy,
  message,
  inputRef,
  onSelect,
  onDrop,
  onImport,
  onClear,
}: {
  files: File[]
  failures: ImageImportFailure[]
  busy: boolean
  message: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onSelect: (files: FileList | File[]) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onImport: () => void
  onClear: () => void
}) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div
        className="rr-card flex min-h-36 flex-col items-center justify-center px-4 py-6 text-center"
        style={{ borderRadius: 3, borderStyle: 'dashed' }}
        onDragOver={event => event.preventDefault()}
        onDrop={onDrop}
      >
        <ImageIcon size={22} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <p className="font-display mt-3" style={{ fontSize: '1.05rem' }}>Drop images here</p>
        <p className="rr-prose mt-1" style={{ fontSize: '0.9rem' }}>Choose up to 10 PNG, JPG, or WebP images. Recall saves the image locally and extracts OCR/vision text when the local model is available.</p>
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          aria-label="Choose image files"
          onChange={event => {
            if (event.currentTarget.files) onSelect(event.currentTarget.files)
          }}
        />
        <button
          className="rr-btn mt-4"
          disabled={busy}
          aria-label="Choose image files"
          title="Choose up to 10 images to save as local media cards."
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          Choose images
        </button>
      </div>
      {files.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <div className="flex items-center justify-between gap-3">
            <p className="rr-mono">{files.length} selected {files.length === 1 ? 'image' : 'images'}</p>
            <button className="rr-link rr-mono" type="button" onClick={onClear} disabled={busy}>Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected image files">
            {files.map(file => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="rr-tag">
                {file.name} · {formatFileSize(file.size)}
              </span>
            ))}
          </div>
        </div>
      )}
      <DefaultActionSelect />
      {failures.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Image import issues</p>
          <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.9rem' }}>
            {failures.map(failure => (
              <li key={`${failure.name}-${failure.error}`}>{failure.name}: {failure.error}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="rr-mono min-h-4">{message}</span>
        <button
          className="rr-btn rr-btn-accent"
          disabled={busy || files.length === 0}
          onClick={onImport}
          type="button"
        >
          {busy ? 'Importing…' : 'Import images'}
        </button>
      </div>
    </div>
  )
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function ImportPanel({
  markdownFiles,
  markdownFailures,
  bookmarkFiles,
  bookmarkFailures,
  pocketFiles,
  pocketFailures,
  socialBookmarkFiles,
  socialBookmarkFailures,
  busy,
  message,
  markdownInputRef,
  bookmarkInputRef,
  pocketInputRef,
  socialBookmarksInputRef,
  onSelectMarkdown,
  onDropMarkdown,
  onImportMarkdown,
  onClearMarkdown,
  onSelectBookmarks,
  onDropBookmarks,
  onImportBookmarks,
  onClearBookmarks,
  onSelectPocket,
  onDropPocket,
  onImportPocket,
  onClearPocket,
  onSelectSocialBookmarks,
  onDropSocialBookmarks,
  onImportSocialBookmarks,
  onClearSocialBookmarks,
}: {
  markdownFiles: File[]
  markdownFailures: MarkdownImportFailure[]
  bookmarkFiles: File[]
  bookmarkFailures: BookmarkImportFailure[]
  pocketFiles: File[]
  pocketFailures: PocketImportFailure[]
  socialBookmarkFiles: File[]
  socialBookmarkFailures: SocialBookmarksImportFailure[]
  busy: boolean
  message: string | null
  markdownInputRef: React.RefObject<HTMLInputElement | null>
  bookmarkInputRef: React.RefObject<HTMLInputElement | null>
  pocketInputRef: React.RefObject<HTMLInputElement | null>
  socialBookmarksInputRef: React.RefObject<HTMLInputElement | null>
  onSelectMarkdown: (files: FileList | File[]) => void
  onDropMarkdown: (event: DragEvent<HTMLDivElement>) => void
  onImportMarkdown: () => void
  onClearMarkdown: () => void
  onSelectBookmarks: (files: FileList | File[]) => void
  onDropBookmarks: (event: DragEvent<HTMLDivElement>) => void
  onImportBookmarks: () => void
  onClearBookmarks: () => void
  onSelectPocket: (files: FileList | File[]) => void
  onDropPocket: (event: DragEvent<HTMLDivElement>) => void
  onImportPocket: () => void
  onClearPocket: () => void
  onSelectSocialBookmarks: (files: FileList | File[]) => void
  onDropSocialBookmarks: (event: DragEvent<HTMLDivElement>) => void
  onImportSocialBookmarks: () => void
  onClearSocialBookmarks: () => void
}) {
  return (
    <div className="space-y-4" aria-live="polite">
      <p className="rr-prose" style={{ fontSize: '0.92rem' }}>
        Import browser bookmark exports, Pocket CSV exports, Social Bookmarks Triage JSON, and Markdown archives as local cards.
      </p>
      <div
        className="rr-card flex min-h-32 flex-col items-center justify-center px-4 py-5 text-center"
        style={{ borderRadius: 3, borderStyle: 'dashed' }}
        onDragOver={event => event.preventDefault()}
        onDrop={onDropBookmarks}
      >
        <BookOpen size={22} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <p className="font-display mt-3" style={{ fontSize: '1.05rem' }}>Drop browser bookmarks HTML here</p>
        <p className="rr-prose mt-1" style={{ fontSize: '0.9rem' }}>Choose one Chrome, Firefox, or Edge bookmarks export. Recall imports public http(s) links, preserves folder paths, and skips duplicates.</p>
        <input
          ref={bookmarkInputRef}
          type="file"
          accept=".html,.htm,text/html"
          className="sr-only"
          aria-label="Browser bookmarks file chooser"
          onChange={event => {
            if (event.currentTarget.files) onSelectBookmarks(event.currentTarget.files)
          }}
        />
        <button
          className="rr-btn mt-4"
          disabled={busy}
          aria-label="Choose browser bookmarks file"
          title="Choose one Chrome, Firefox, or Edge bookmarks HTML export."
          onClick={() => bookmarkInputRef.current?.click()}
          type="button"
        >
          Choose bookmarks
        </button>
      </div>
      {bookmarkFiles.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <div className="flex items-center justify-between gap-3">
            <p className="rr-mono">1 selected bookmarks export</p>
            <button className="rr-link rr-mono" type="button" onClick={onClearBookmarks} disabled={busy}>Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected browser bookmarks files">
            {bookmarkFiles.map(file => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="rr-tag">
                {file.name} · {formatFileSize(file.size)}
              </span>
            ))}
          </div>
        </div>
      )}
      {bookmarkFailures.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Browser bookmarks import issues</p>
          <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.9rem' }}>
            {bookmarkFailures.map(failure => (
              <li key={`${failure.name}-${failure.error}`}>{failure.name}: {failure.error}</li>
            ))}
          </ul>
        </div>
      )}
      <div
        className="rr-card flex min-h-36 flex-col items-center justify-center px-4 py-6 text-center"
        style={{ borderRadius: 3, borderStyle: 'dashed' }}
        onDragOver={event => event.preventDefault()}
        onDrop={onDropMarkdown}
      >
        <FileText size={22} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <p className="font-display mt-3" style={{ fontSize: '1.05rem' }}>Drop Markdown files here</p>
        <p className="rr-prose mt-1" style={{ fontSize: '0.9rem' }}>Choose up to 10 `.md` or `.markdown` files. Recall stores the original Markdown as Reader text and summarizes it locally.</p>
        <input
          ref={markdownInputRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/x-markdown"
          multiple
          className="sr-only"
          aria-label="Markdown file chooser"
          onChange={event => {
            if (event.currentTarget.files) onSelectMarkdown(event.currentTarget.files)
          }}
        />
        <button
          className="rr-btn mt-4"
          disabled={busy}
          aria-label="Choose Markdown files"
          title="Choose up to 10 Markdown files to save as local document cards."
          onClick={() => markdownInputRef.current?.click()}
          type="button"
        >
          Choose Markdown
        </button>
      </div>
      {markdownFiles.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <div className="flex items-center justify-between gap-3">
            <p className="rr-mono">{markdownFiles.length} selected Markdown {markdownFiles.length === 1 ? 'file' : 'files'}</p>
            <button className="rr-link rr-mono" type="button" onClick={onClearMarkdown} disabled={busy}>Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected Markdown files">
            {markdownFiles.map(file => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="rr-tag">
                {file.name} · {formatFileSize(file.size)}
              </span>
            ))}
          </div>
        </div>
      )}
      <DefaultActionSelect />
      {markdownFailures.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Markdown import issues</p>
          <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.9rem' }}>
            {markdownFailures.map(failure => (
              <li key={`${failure.name}-${failure.error}`}>{failure.name}: {failure.error}</li>
            ))}
          </ul>
        </div>
      )}
      <div
        className="rr-card flex min-h-32 flex-col items-center justify-center px-4 py-5 text-center"
        style={{ borderRadius: 3, borderStyle: 'dashed' }}
        onDragOver={event => event.preventDefault()}
        onDrop={onDropPocket}
      >
        <FileArchive size={22} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <p className="font-display mt-3" style={{ fontSize: '1.05rem' }}>Drop Pocket CSV here</p>
        <p className="rr-prose mt-1" style={{ fontSize: '0.9rem' }}>Choose one Pocket export CSV. Recall imports public links, preserves Pocket tags/status metadata, and skips duplicates.</p>
        <input
          ref={pocketInputRef}
          type="file"
          accept=".csv,text/csv,application/csv,application/vnd.ms-excel"
          className="sr-only"
          aria-label="Pocket CSV file chooser"
          onChange={event => {
            if (event.currentTarget.files) onSelectPocket(event.currentTarget.files)
          }}
        />
        <button
          className="rr-btn mt-4"
          disabled={busy}
          aria-label="Choose Pocket CSV file"
          title="Choose one Pocket CSV export."
          onClick={() => pocketInputRef.current?.click()}
          type="button"
        >
          Choose Pocket CSV
        </button>
      </div>
      {pocketFiles.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <div className="flex items-center justify-between gap-3">
            <p className="rr-mono">1 selected Pocket CSV</p>
            <button className="rr-link rr-mono" type="button" onClick={onClearPocket} disabled={busy}>Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected Pocket CSV files">
            {pocketFiles.map(file => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="rr-tag">
                {file.name} · {formatFileSize(file.size)}
              </span>
            ))}
          </div>
        </div>
      )}
      {pocketFailures.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Pocket import issues</p>
          <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.9rem' }}>
            {pocketFailures.map(failure => (
              <li key={`${failure.name}-${failure.error}`}>{failure.name}: {failure.error}</li>
            ))}
          </ul>
        </div>
      )}
      <div
        className="rr-card flex min-h-32 flex-col items-center justify-center px-4 py-5 text-center"
        style={{ borderRadius: 3, borderStyle: 'dashed' }}
        onDragOver={event => event.preventDefault()}
        onDrop={onDropSocialBookmarks}
      >
        <FileJson size={22} aria-hidden="true" style={{ color: 'var(--accent)', strokeWidth: 1.7 }} />
        <p className="font-display mt-3" style={{ fontSize: '1.05rem' }}>Drop Social Bookmarks JSON here</p>
        <p className="rr-prose mt-1" style={{ fontSize: '0.9rem' }}>Choose one Social Bookmarks Triage JSON export or bookmarklet file. Recall preserves social source metadata, categories, semantic tags, actionability, and media references.</p>
        <input
          ref={socialBookmarksInputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Social Bookmarks JSON file chooser"
          onChange={event => {
            if (event.currentTarget.files) onSelectSocialBookmarks(event.currentTarget.files)
          }}
        />
        <button
          className="rr-btn mt-4"
          disabled={busy}
          aria-label="Choose Social Bookmarks JSON file"
          title="Choose one Social Bookmarks Triage JSON export or bookmarklet file."
          onClick={() => socialBookmarksInputRef.current?.click()}
          type="button"
        >
          Choose Social JSON
        </button>
      </div>
      {socialBookmarkFiles.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <div className="flex items-center justify-between gap-3">
            <p className="rr-mono">1 selected Social Bookmarks JSON</p>
            <button className="rr-link rr-mono" type="button" onClick={onClearSocialBookmarks} disabled={busy}>Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected Social Bookmarks JSON files">
            {socialBookmarkFiles.map(file => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="rr-tag">
                {file.name} · {formatFileSize(file.size)}
              </span>
            ))}
          </div>
        </div>
      )}
      {socialBookmarkFailures.length > 0 && (
        <div className="rr-card p-3" style={{ borderRadius: 3 }}>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>Social Bookmarks import issues</p>
          <ul className="mt-2 space-y-1 rr-prose" style={{ fontSize: '0.9rem' }}>
            {socialBookmarkFailures.map(failure => (
              <li key={`${failure.name}-${failure.error}`}>{failure.name}: {failure.error}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2 pt-1 lg:flex-row lg:items-center lg:justify-between">
        <span className="rr-mono min-h-4">{message}</span>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            className="rr-btn"
            disabled={busy || bookmarkFiles.length === 0}
            onClick={onImportBookmarks}
            type="button"
          >
            {busy ? 'Importing…' : 'Import bookmarks'}
          </button>
          <button
            className="rr-btn"
            disabled={busy || pocketFiles.length === 0}
            onClick={onImportPocket}
            type="button"
          >
            {busy ? 'Importing…' : 'Import Pocket'}
          </button>
          <button
            className="rr-btn"
            disabled={busy || socialBookmarkFiles.length === 0}
            onClick={onImportSocialBookmarks}
            type="button"
          >
            {busy ? 'Importing…' : 'Import Social Bookmarks'}
          </button>
          <button
            className="rr-btn rr-btn-accent"
            disabled={busy || markdownFiles.length === 0}
            onClick={onImportMarkdown}
            type="button"
          >
            {busy ? 'Importing…' : 'Import Markdown'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DefaultActionSelect({ disabled = false }: { disabled?: boolean }) {
  return (
    <label className="block rr-rule py-2">
      <span className="rr-mono">Default action</span>
      <select
        aria-label={disabled ? 'Default AI action (planned)' : 'Default AI action'}
        title={disabled ? 'Only concise Notebook summaries are active in Phase 1.' : undefined}
        value="concise-summary"
        disabled={disabled}
        className="rr-select mt-2 w-full"
        onChange={() => {}}
      >
        <option value="concise-summary">Concise summary</option>
        <option value="detailed-summary" disabled>Detailed summary · Phase 2</option>
        <option value="quiz" disabled>Generate quiz · Phase 3</option>
        <option value="connections" disabled>Find connections · Phase 2</option>
      </select>
      <span className="rr-prose mt-1 block" style={{ fontSize: '0.84rem' }}>
        Recall creates a Notebook TL;DR, key points, reader text, and tags when local extraction succeeds.
      </span>
    </label>
  )
}
