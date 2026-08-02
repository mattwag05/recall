// Minimal, dependency-free Markdown → HTML for notebook content.
// Handles: ## / ### headings, - bullets, **bold**, *italic*, links,
// blockquotes, and paragraphs. Input is escaped first, so it's safe for our own
// LLM output.
//
// Defense-in-depth: HTML output is then passed through DOMPurify with an
// explicit allowlist so any attacker-injected `<script>`, event handlers,
// or `javascript:` URLs are stripped before reaching the browser.
//
// On top of Markdown, an optional MarkdownLinkContext turns two things into
// links (see linkifyHtml): "01:34" timestamps, which deep-link back into the
// card's source at that second, and entity/card labels that resolve to a saved
// card. Both are emitted as plain <a href> with the attributes the allowlist
// already permits — the allowlist is deliberately NOT widened for them, and the
// hrefs still go through sanitizeHref + DOMPurify.

import DOMPurify from "dompurify"
import { sourceTimestampHref, timestampSeconds, TIMESTAMP_SOURCE } from "./media-timestamps"

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ["p", "h1", "h2", "h3", "strong", "em", "code", "a", "ul", "li", "blockquote", "br"],
  ALLOWED_ATTR: ["href", "target", "rel", "id"],
}

let _purify: ReturnType<typeof DOMPurify> | null = null

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

export interface MarkdownLinkContext {
  /** The card's source URL. Timestamps in the text deep-link into it. */
  sourceUrl?: string | null
  /** Labels that resolve to a saved card — `[[wiki links]]` and prose mentions. */
  entityCards?: { label: string; cardId: string }[]
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

export function renderMarkdown(md: string, context?: MarkdownLinkContext): string {
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
  return sanitizeHtml(linkifyHtml(out.join('\n'), context))
}

/** Plain text → paragraphs for the Reader view. */
export function renderReader(text: string, context?: MarkdownLinkContext): string {
  const html = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
  return sanitizeHtml(linkifyHtml(html, context))
}

// ── timestamp + entity linking ───────────────────────────────────────
//
// Runs over the HTML we just generated, never over raw user input, and always
// before sanitizeHtml. Text is split on tags so replacements only ever touch
// text nodes, and anchors/code spans are skipped so we never nest an <a> or
// rewrite a URL the author typed.

const WIKI_SOURCE = '\\[\\[([^\\]\\n]{1,160})\\]\\]'
const TAG_SPLIT = /(<[^>]*>)/
/** Long enough that a mention is deliberate, not an "AI"/"UI" false positive. */
const MIN_PROSE_ENTITY_CHARS = 3

export function linkifyHtml(html: string, context?: MarkdownLinkContext): string {
  const entityIndex = buildEntityIndex(context?.entityCards)
  const sourceUrl = context?.sourceUrl ?? null
  if (!sourceUrl && entityIndex.size === 0) return html

  const proseLabels = [...entityIndex.keys()]
    .filter(key => key.length >= MIN_PROSE_ENTITY_CHARS && /^[a-z0-9].*[a-z0-9]$/i.test(key) && !/^\d+$/.test(key))
    .sort((a, b) => b.length - a.length)

  const pattern = [
    WIKI_SOURCE,
    TIMESTAMP_SOURCE,
    proseLabels.length > 0 ? `\\b(${proseLabels.map(escapeRegExp).join('|')})\\b` : null,
  ].filter((part): part is string => part !== null).join('|')

  const matcher = new RegExp(pattern, 'gi')
  // One mention per label per document — linking every occurrence turns prose
  // into a wall of links.
  const linkedLabels = new Set<string>()

  let inAnchor = 0
  let inCode = 0
  return html.split(TAG_SPLIT).map(segment => {
    if (segment.startsWith('<')) {
      if (/^<a\b/i.test(segment)) inAnchor += 1
      else if (/^<\/a\s*>/i.test(segment)) inAnchor = Math.max(0, inAnchor - 1)
      else if (/^<code\b/i.test(segment)) inCode += 1
      else if (/^<\/code\s*>/i.test(segment)) inCode = Math.max(0, inCode - 1)
      return segment
    }
    if (!segment || inAnchor > 0 || inCode > 0) return segment

    // `replace` appends (offset, wholeString) after the capture groups, and the
    // entity group only exists when there are prose labels — so every group is
    // typeof-checked rather than compared against undefined.
    return segment.replace(matcher, (
      match: string,
      wikiTitle: unknown,
      tsPrefix: unknown,
      tsFirst: unknown,
      tsSecond: unknown,
      tsThird: unknown,
      entity: unknown,
    ) => {
      if (typeof wikiTitle === 'string') {
        const title = wikiTitle.trim()
        const href = cardHref(entityIndex.get(title.toLowerCase()))
        // An unresolved [[title]] stays literal: that is how the author sees the
        // link did not land on a card.
        if (!href) return match
        // An explicit wiki link counts as the document's one link for that label,
        // so a later prose mention of the same name is not linked again.
        linkedLabels.add(title.toLowerCase())
        return `<a href="${href}">${title}</a>`
      }

      if (typeof tsFirst === 'string' && typeof tsSecond === 'string') {
        const third = typeof tsThird === 'string' ? tsThird : undefined
        const seconds = timestampSeconds(tsFirst, tsSecond, third)
        const href = seconds === null ? null : sanitizeHref(sourceTimestampHref(sourceUrl, seconds) ?? '')
        const label = third === undefined ? `${tsFirst}:${tsSecond}` : `${tsFirst}:${tsSecond}:${third}`
        if (!href) return match
        return `${typeof tsPrefix === 'string' ? tsPrefix : ''}<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
      }

      if (typeof entity === 'string') {
        const key = entity.toLowerCase()
        if (linkedLabels.has(key)) return match
        const href = cardHref(entityIndex.get(key))
        if (!href) return match
        linkedLabels.add(key)
        return `<a href="${href}">${entity}</a>`
      }

      return match
    })
  }).join('')
}

/** Keys are the HTML-escaped, lowercased label, because that is what the text stream holds. */
function buildEntityIndex(entityCards: MarkdownLinkContext['entityCards']): Map<string, string> {
  const index = new Map<string, string>()
  for (const entry of entityCards ?? []) {
    const key = escapeHtml(entry.label ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (!key || !entry.cardId || index.has(key)) continue
    index.set(key, entry.cardId)
  }
  return index
}

function cardHref(cardId: string | undefined): string | null {
  if (!cardId || !/^[A-Za-z0-9_-]+$/.test(cardId)) return null
  return sanitizeHref(`/item/${cardId}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
