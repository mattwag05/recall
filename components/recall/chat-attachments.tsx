'use client'

import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import type { ChatAttachment } from '@/lib/recall-types'

export type ChatAttachmentDraft = ChatAttachment & {
  id: string
}

export const MAX_CHAT_ATTACHMENTS = 4
const MAX_CHAT_ATTACHMENT_BYTES = 1024 * 1024
const MAX_CHAT_ATTACHMENT_CHARS = 12000
const CHAT_ATTACHMENT_ACCEPT = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.jsonl',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.swift',
  '.kt',
  '.sql',
  '.sh',
  '.zsh',
  '.toml',
  '.ini',
  '.log',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  'text/*',
  'application/json',
  'application/xml',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
].join(',')

const READABLE_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'swift',
  'kt',
  'sql',
  'sh',
  'zsh',
  'toml',
  'ini',
  'log',
])

const READABLE_TYPES = new Set([
  'application/json',
  'application/jsonl',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
  'text/yaml',
])

export function ChatAttachmentControl({
  attachments,
  disabled,
  onAdd,
  onRemove,
  buttonClassName = 'rr-btn rr-btn-icon',
  label = 'Upload chat attachment',
}: {
  attachments: ChatAttachmentDraft[]
  disabled?: boolean
  onAdd: (attachments: ChatAttachmentDraft[]) => void
  onRemove: (id: string) => void
  buttonClassName?: string
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadError(null)
    const { drafts, errors } = await readChatAttachmentFiles(files, attachments.length)
    if (drafts.length > 0) onAdd(drafts)
    setUploadError(errors[0] ?? null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label={label}
        accept={CHAT_ATTACHMENT_ACCEPT}
        onChange={event => void onFiles(event.currentTarget.files)}
      />
      <button
        className={buttonClassName}
        type="button"
        disabled={disabled || attachments.length >= MAX_CHAT_ATTACHMENTS}
        aria-label="Upload temporary chat context"
        title="Attach readable text, Markdown, CSV, JSON, code, extractable PDFs, or PNG/JPG/WebP images as temporary chat context."
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip size={14} aria-hidden="true" />
        <span>Upload</span>
      </button>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Temporary chat attachments">
          {attachments.map(attachment => (
            <span key={attachment.id} className="rr-tag inline-flex max-w-full items-center gap-2">
              <span className="min-w-0" style={{ overflowWrap: 'anywhere' }}>
                {attachment.name} · {formatFileSize(attachment.size)} · {attachment.text.length.toLocaleString()} chars
              </span>
              <button
                type="button"
                className="rr-link"
                aria-label={`Remove ${attachment.name} from temporary chat context`}
                onClick={() => onRemove(attachment.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {uploadError && <p className="rr-mono" style={{ color: 'var(--accent)' }}>{uploadError}</p>}
    </div>
  )
}

async function readChatAttachmentFiles(files: FileList, existingCount: number): Promise<{ drafts: ChatAttachmentDraft[]; errors: string[] }> {
  const drafts: ChatAttachmentDraft[] = []
  const errors: string[] = []
  const availableSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - existingCount)
  if (availableSlots === 0) {
    return { drafts, errors: [`Upload up to ${MAX_CHAT_ATTACHMENTS} files per chat message.`] }
  }

  for (const file of Array.from(files).slice(0, availableSlots)) {
    const readableError = validateReadableFile(file)
    if (readableError) {
      errors.push(readableError)
      continue
    }
    let rawText: string
    let extractedType: string | null = null
    if (isServerExtractedFile(file)) {
      const extracted = await extractServerAttachment(file)
      if ('error' in extracted) {
        errors.push(extracted.error)
        continue
      }
      rawText = extracted.text
      extractedType = extracted.type
    } else {
      rawText = await file.text()
    }
    const text = rawText.trim().slice(0, MAX_CHAT_ATTACHMENT_CHARS)
    if (!text) {
      errors.push(`${file.name} has no readable text content.`)
      continue
    }
    drafts.push({
      id: `${file.name}-${file.size}-${file.lastModified}-${drafts.length}`,
      name: file.name,
      type: extractedType ?? (file.type || null),
      size: file.size,
      text,
    })
  }

  if (files.length > availableSlots) {
    errors.push(`Only ${availableSlots} more ${availableSlots === 1 ? 'file' : 'files'} can be attached.`)
  }
  return { drafts, errors }
}

function validateReadableFile(file: File): string | null {
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) return `${file.name} is larger than 1 MB.`
  if (isPdfFile(file)) return null
  if (isSupportedImageFile(file)) return null
  if (file.type.startsWith('text/') || READABLE_TYPES.has(file.type)) return null
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (READABLE_EXTENSIONS.has(extension)) return null
  if (file.type.startsWith('image/')) return `${file.name} must be a PNG, JPG, or WebP image for OCR/vision.`
  return `${file.name} is not a readable text, Markdown, CSV, JSON, code, PDF, or supported image file.`
}

function isPdfFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type === 'application/pdf' || extension === 'pdf'
}

function isSupportedImageFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/webp' ||
    extension === 'png' ||
    extension === 'jpg' ||
    extension === 'jpeg' ||
    extension === 'webp'
}

function isServerExtractedFile(file: File): boolean {
  return isPdfFile(file) || isSupportedImageFile(file)
}

async function extractServerAttachment(file: File): Promise<{ text: string; type: string | null } | { error: string }> {
  const formData = new FormData()
  formData.append('file', file)
  try {
    const res = await fetch('/api/chat/attachments/extract', {
      method: 'POST',
      body: formData,
    })
    const data = await res.json().catch(() => null) as unknown
    if (!res.ok) return { error: apiError(data, `Could not extract chat context from ${file.name}.`) }
    if (!isAttachmentExtractionResponse(data)) return { error: 'The local attachment extraction API returned an unexpected response.' }
    return { text: data.attachment.text, type: data.attachment.type }
  } catch {
    return { error: `Could not extract chat context from ${file.name}. Check that the local app is still running, then try again.` }
  }
}

function isAttachmentExtractionResponse(data: unknown): data is { ok: true; attachment: { text: string; type: string | null } } {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  const attachment = record.attachment
  if (record.ok !== true || !attachment || typeof attachment !== 'object') return false
  const attachmentRecord = attachment as Record<string, unknown>
  return typeof attachmentRecord.text === 'string' &&
    (attachmentRecord.type === null || typeof attachmentRecord.type === 'string')
}

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error
  }
  return fallback
}

function formatFileSize(size: number | null): string {
  if (size === null) return 'unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
