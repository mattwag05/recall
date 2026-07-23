// Minimal, dependency-free Markdown → HTML for notebook content.
// Handles: ## / ### headings, - bullets, **bold**, *italic*, links,
// blockquotes, and paragraphs. Input is escaped first, so it's safe for our own
// LLM output.
//
// Defense-in-depth: HTML output is then passed through DOMPurify with an
// explicit allowlist so any attacker-injected `<script>`, event handlers,
// or `javascript:` URLs are stripped before reaching the browser.

import DOMPurify from "dompurify"

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ["p", "h1", "h2", "h3", "strong", "em", "code", "a", "ul", "li", "blockquote", "br"],
  ALLOWED_ATTR: ["href", "target", "rel", "id"],
}

let _purify: {
  sanitize(html: string, opts?: Record<string, unknown>): string
  removed: string[]
  isSupported: boolean
  setConfig(opts: Record<string, unknown>): void
  clearConfig(): void
  isValidAttribute(attrName: string, value: string): boolean
  addHook(hookType: string, callback: (el: unknown, data: Record<string, unknown>, config: Record<string, unknown>) => void): void
  removeHook(hookType: string): void
  removeHooks(types: string[]): void
  removeAllHooks(): void
  version: string
} | null = null

function getPurify() {
  if (_purify) return _purify
  if (typeof window !== "undefined") {
    _purify = DOMPurify(window)
  } else {
    const { JSDOM } = require("jsdom")
    _purify = DOMPurify(new JSDOM("").window)
  }
  return _purify
}

function sanitizeHtml(html: string): string {
  return getPurify().sanitize(html, {
    ADD_TAGS: PURIFY_CONFIG.ALLOWED_TAGS,
    ADD_ATTR: PURIFY_CONFIG.ALLOWED_ATTR,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
      const safeHref = sanitizeHref(href)
      if (!safeHref) return label
      return `<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>`
    })
}

function sanitizeHref(href: string): string | null {
  const trimmed = href.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return escapeAttribute(trimmed)

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return escapeAttribute(trimmed)
    }
  } catch {}

  return null
}

function escapeAttribute(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface MarkdownHeading {
  id: string
  level: number
  text: string
}

function headingText(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function slugifyHeading(s: string): string {
  const slug = headingText(s)
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

export function markdownHeadings(md: string): MarkdownHeading[] {
  const seen = new Map<string, number>()
  return escapeHtml(md.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
    .split('\n')
    .flatMap(raw => {
      const line = raw.trimEnd()
      const h = line.match(/^(#{1,3})\s+(.*)$/)
      if (!h) return []
      const base = slugifyHeading(h[2])
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      return [{
        id: count ? `${base}-${count + 1}` : base,
        level: h[1].length,
        text: headingText(h[2]),
      }]
    })
}

export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '')).split('\n')
  const out: string[] = []
  let inList = false
  let para: string[] = []
  const headingCounts = new Map<string, number>()

  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] }
  }
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushPara(); closeList(); continue }

    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      flushPara()
      closeList()
      const lvl = h[1].length
      const base = slugifyHeading(h[2])
      const count = headingCounts.get(base) ?? 0
      headingCounts.set(base, count + 1)
      const id = count ? `${base}-${count + 1}` : base
      out.push(`<h${lvl} id="${escapeAttribute(id)}">${inline(h[2])}</h${lvl}>`)
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) { flushPara(); if (!inList) { out.push('<ul>'); inList = true } out.push(`<li>${inline(bullet[1])}</li>`); continue }

    const quote = line.match(/^>\s+(.*)$/)
    if (quote) { flushPara(); closeList(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue }

    para.push(line.trim())
  }
  flushPara(); closeList()
  return sanitizeHtml(out.join('\n'))
}

/** Plain text → paragraphs for the Reader view. */
export function renderReader(text: string): string {
  const html = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
  return sanitizeHtml(html)
}
