import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

export interface ExtractedArticle {
  title: string
  byline: string | null
  textContent: string // plain readable text (Recall "readerContent")
  excerpt: string | null
  siteName: string | null
  lengthChars: number
  leadImage: string | null
}

export interface PageMetadata {
  title: string
  description: string | null
  siteName: string | null
  leadImage: string | null
  canonicalUrl: string | null
}

function metaContent(doc: Document, selectors: string[]): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    const c = el?.getAttribute('content')?.trim()
    if (c) return c
  }
  return null
}

function pageMetadata(doc: Document, url: string): PageMetadata {
  const title =
    metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    doc.querySelector('title')?.textContent?.trim() ||
    url
  const description = metaContent(doc, [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  ])
  const siteName = metaContent(doc, [
    'meta[property="og:site_name"]',
    'meta[name="application-name"]',
  ])
  const leadImage = metaContent(doc, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ])
  const canonicalUrl =
    doc.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() ||
    metaContent(doc, ['meta[property="og:url"]'])

  return {
    title,
    description,
    siteName,
    leadImage,
    canonicalUrl,
  }
}

/**
 * Fetches a URL and extracts clean, readable article text via Mozilla
 * Readability (the same engine behind Firefox Reader View). Returns the full
 * body text plus metadata. Throws on fetch failure; callers should fall back to
 * OG metadata.
 */
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 Recall/0.1',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`)
  const html = await res.text()

  const dom = new JSDOM(html, { url })
  const doc = dom.window.document

  const metadata = pageMetadata(doc, url)

  const reader = new Readability(doc)
  const parsed = reader.parse()

  const textContent = (parsed?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
  const title =
    parsed?.title?.trim() ||
    metadata.title

  return {
    title,
    byline: parsed?.byline ?? null,
    textContent,
    excerpt:
      parsed?.excerpt?.trim() ||
      metadata.description,
    siteName: parsed?.siteName ?? metadata.siteName,
    lengthChars: textContent.length,
    leadImage: metadata.leadImage,
  }
}

/** Fetches only standard page metadata for source types that do not expose reader text. */
export async function extractPageMetadata(url: string): Promise<PageMetadata> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 Recall/0.1',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`)
  const html = await res.text()
  const dom = new JSDOM(html, { url })
  return pageMetadata(dom.window.document, url)
}

/** Rough read-time estimate in minutes (≈220 wpm). */
export function readTimeMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

/** Provider/source label from a URL hostname (e.g. "nytimes.com"). */
export function providerFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'web'
  }
}
