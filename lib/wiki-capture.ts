import { createHash } from 'crypto'
import { JSDOM } from 'jsdom'

export type WikiSearchResult = {
  title: string
  description: string
  url: string
}

export type WikiCaptureResult = {
  postId: string
  title: string
  text: string
  body: string
  url: string
  thumbnail: string | null
  rawJson: Record<string, unknown>
}

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const WIKIPEDIA_ORIGIN = 'https://en.wikipedia.org'
const USER_AGENT =
  'Recall/0.1 local-first knowledge capture (https://localhost; contact local user)'

export async function searchWikipediaTopics(query: string, limit = 5): Promise<WikiSearchResult[]> {
  const search = query.trim()
  if (!search) return []

  const params = new URLSearchParams({
    action: 'opensearch',
    namespace: '0',
    redirects: 'resolve',
    search,
    limit: String(Math.min(Math.max(limit, 1), 10)),
    format: 'json',
  })
  const data = await fetchJson(`${WIKIPEDIA_API}?${params}`)
  if (!Array.isArray(data) || !Array.isArray(data[1]) || !Array.isArray(data[2]) || !Array.isArray(data[3])) {
    throw new Error('Wikipedia search returned an unexpected response')
  }

  const titles = data[1] as unknown[]
  const descriptions = data[2] as unknown[]
  const urls = data[3] as unknown[]

  return titles.flatMap((title, index) => {
    if (typeof title !== 'string' || !title.trim()) return []
    const url = typeof urls[index] === 'string' ? urls[index] as string : wikipediaUrlForTitle(title)
    return [{
      title,
      description: typeof descriptions[index] === 'string' ? descriptions[index] as string : '',
      url,
    }]
  })
}

export async function captureWikipediaTopic(rawTitle: string): Promise<WikiCaptureResult> {
  const title = rawTitle.trim()
  if (!title) throw new Error('Enter a Wikipedia topic before importing.')

  const resolved = (await searchWikipediaTopics(title, 1))[0]
  const page = resolved?.title ?? title
  const params = new URLSearchParams({
    action: 'parse',
    page,
    redirects: '1',
    prop: 'text|displaytitle|revid',
    format: 'json',
    formatversion: '2',
  })
  const data = await fetchJson(`${WIKIPEDIA_API}?${params}`)
  if (!data || typeof data !== 'object' || !('parse' in data)) {
    throw new Error('Wikipedia topic not found.')
  }

  const parse = (data as { parse?: unknown }).parse
  if (!parse || typeof parse !== 'object') {
    throw new Error('Wikipedia topic not found.')
  }
  const parseRecord = parse as Record<string, unknown>
  const pageTitle = typeof parseRecord.title === 'string'
    ? parseRecord.title
    : typeof parseRecord.displaytitle === 'string'
      ? stripHtml(parseRecord.displaytitle)
      : page
  const html = htmlFromParseText(parseRecord.text)
  const body = textFromWikipediaHtml(html)
  if (!body) throw new Error('Wikipedia returned an empty page for this topic.')

  const url = wikipediaUrlForTitle(pageTitle)
  const thumbnail = firstImageFromWikipediaHtml(html)
  const text = firstParagraph(body) || `${pageTitle} from Wikipedia`
  const postId = `wiki:${createHash('sha256').update(url).digest('base64url')}`

  return {
    postId,
    title: pageTitle,
    text,
    body,
    url,
    thumbnail,
    rawJson: {
      postId,
      platform: 'wikipedia',
      provider: 'wikipedia.org',
      title: pageTitle,
      url,
      captureMode: 'wikipedia-parse',
      revid: typeof parseRecord.revid === 'number' ? parseRecord.revid : null,
    },
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Wikipedia request failed with ${res.status}`)
  return res.json() as Promise<unknown>
}

function htmlFromParseText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)['*'] === 'string') {
    return (value as Record<string, string>)['*']
  }
  return ''
}

function textFromWikipediaHtml(html: string): string {
  if (!html.trim()) return ''
  const dom = new JSDOM(html, { url: WIKIPEDIA_ORIGIN })
  const doc = dom.window.document
  doc.querySelectorAll(
    [
      '.mw-editsection',
      '.reference',
      '.reflist',
      '.navbox',
      '.metadata',
      '.ambox',
      'style',
      'script',
      'table',
      'sup',
    ].join(','),
  ).forEach(node => node.remove())

  const parts: string[] = []
  for (const element of Array.from(doc.body.querySelectorAll('p, h2, h3, li'))) {
    const text = element.textContent?.replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (/^Contents$|^References$|^External links$|^See also$/i.test(text)) continue
    parts.push(text)
    if (parts.join('\n\n').length > 24000) break
  }
  return parts.join('\n\n').trim()
}

function firstImageFromWikipediaHtml(html: string): string | null {
  if (!html.trim()) return null
  const dom = new JSDOM(html, { url: WIKIPEDIA_ORIGIN })
  const img = dom.window.document.querySelector('img[src*="/thumb/"], img[src^="//upload.wikimedia.org/"]')
  const src = img?.getAttribute('src')
  if (!src) return null
  if (src.startsWith('//')) return `https:${src}`
  try {
    return new URL(src, WIKIPEDIA_ORIGIN).href
  } catch {
    return null
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function firstParagraph(text: string): string {
  return text.split(/\n{2,}/).map(part => part.trim()).find(Boolean)?.slice(0, 500) ?? ''
}

function wikipediaUrlForTitle(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.trim().replace(/\s+/g, '_'))}`
}
