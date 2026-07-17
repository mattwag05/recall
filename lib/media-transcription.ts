export type MediaTranscript = {
  text: string
  source: string
  audioUrl: string
  title?: string
}

type AppleLookupResponse = {
  results?: Array<{
    wrapperType?: string
    kind?: string
    trackId?: number
    trackName?: string
    collectionId?: number
    feedUrl?: string
    episodeUrl?: string
  }>
}

const MIN_TRANSCRIPT_CHARS = 120
const DEFAULT_MAX_AUDIO_MB = 100

export async function transcribeMediaPage(url: string, platform: string): Promise<MediaTranscript | null> {
  // Apple Podcasts: resolve episode audio via the iTunes lookup + RSS feed.
  if (platform === 'apple-podcasts') {
    const audio = await resolveApplePodcastAudio(url)
    return audio ? finishTranscript(audio.audioUrl, 'apple-podcasts-transcription', audio.title) : null
  }
  // A direct link to an audio file — transcribe it as-is.
  if (platform === 'direct-audio') {
    return directAudioUrl(url) ? finishTranscript(url, 'direct-audio-transcription') : null
  }
  // A generic podcast / RSS feed — take the first (or matching) enclosure.
  if (platform === 'podcast-rss') {
    const audio = await resolveFeedAudio(url)
    return audio ? finishTranscript(audio.audioUrl, 'podcast-rss-transcription', audio.title) : null
  }
  // Other media platforms (SoundCloud, Bandcamp, Spotify, TikTok, …) hide their
  // audio behind page-specific/obfuscated streams we can't reliably resolve.
  return null
}

async function finishTranscript(audioUrl: string, source: string, title?: string): Promise<MediaTranscript | null> {
  const text = await transcribeAudioUrl(audioUrl)
  if (text.length < MIN_TRANSCRIPT_CHARS) return null
  return { text, source, audioUrl, title }
}

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac']

/** Returns the url when its path points at a direct audio file, else null. */
export function directAudioUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return AUDIO_EXTENSIONS.some(ext => path.endsWith(ext)) ? url : null
  } catch {
    return null
  }
}

/** Heuristic: does the url look like a podcast/RSS feed (by path), not a known
 *  media host? Non-feeds still degrade gracefully (no enclosure → metadata card). */
export function isLikelyFeedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase().replace(/\/$/, '')
    return path.endsWith('.rss') || path.endsWith('.xml') || /\/(feed|rss)$/.test(path)
  } catch {
    return false
  }
}

async function resolveFeedAudio(url: string): Promise<{ audioUrl: string; title?: string } | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`)
  const feed = await res.text()
  return audioFromRss(feed)
}

export function transcriptionConfigured(): boolean {
  return Boolean(process.env.TRANSCRIPTION_BASE_URL)
}

async function resolveApplePodcastAudio(url: string): Promise<{ audioUrl: string; title?: string } | null> {
  const ids = applePodcastIds(url)
  if (!ids.podcastId) return null

  const lookupUrl = new URL('https://itunes.apple.com/lookup')
  lookupUrl.searchParams.set('id', ids.podcastId)
  lookupUrl.searchParams.set('entity', 'podcastEpisode')
  lookupUrl.searchParams.set('limit', '200')

  const res = await fetch(lookupUrl, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Apple Podcasts lookup failed: ${res.status}`)
  const data = await res.json() as AppleLookupResponse
  const results = Array.isArray(data.results) ? data.results : []
  const episode = ids.episodeId
    ? results.find(item => item.wrapperType === 'podcastEpisode' && String(item.trackId) === ids.episodeId)
    : results.find(item => item.wrapperType === 'podcastEpisode')
  if (episode?.episodeUrl) return { audioUrl: episode.episodeUrl, title: episode.trackName }

  const feedUrl = results.find(item => item.feedUrl)?.feedUrl
  if (!feedUrl) return null
  const feedRes = await fetch(feedUrl, { signal: AbortSignal.timeout(15000) })
  if (!feedRes.ok) throw new Error(`Podcast feed fetch failed: ${feedRes.status}`)
  const feed = await feedRes.text()
  return audioFromRss(feed, episode?.trackName)
}

function applePodcastIds(url: string): { podcastId: string | null; episodeId: string | null } {
  try {
    const parsed = new URL(url)
    const podcastId = parsed.pathname.match(/\/id(\d+)/)?.[1] ?? null
    return { podcastId, episodeId: parsed.searchParams.get('i') }
  } catch {
    return { podcastId: null, episodeId: null }
  }
}

function audioFromRss(feed: string, title?: string): { audioUrl: string; title?: string } | null {
  const items = Array.from(feed.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map(match => match[0])
  const wanted = title ? normalize(title) : ''
  const item = wanted
    ? items.find(value => normalize(textTag(value, 'title')) === wanted)
    : items[0]
  if (!item) return null
  const audioUrl = item.match(/<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i)?.[1]
  if (!audioUrl) return null
  return { audioUrl: decodeXml(audioUrl), title: textTag(item, 'title') || title }
}

async function transcribeAudioUrl(audioUrl: string): Promise<string> {
  const base = process.env.TRANSCRIPTION_BASE_URL
  if (!base) {
    throw new Error('Local transcription is not configured. Set TRANSCRIPTION_BASE_URL to an OpenAI-compatible Whisper endpoint.')
  }

  const audio = await fetchAudio(audioUrl)
  const endpoint = transcriptionEndpoint(base)
  const form = new FormData()
  form.set('model', process.env.TRANSCRIPTION_MODEL || 'whisper-1')
  form.set('file', new Blob([audio.bytes], { type: audio.contentType || 'audio/mpeg' }), filenameForAudio(audioUrl, audio.contentType))

  const headers: HeadersInit = {}
  if (process.env.TRANSCRIPTION_API_KEY) headers.Authorization = `Bearer ${process.env.TRANSCRIPTION_API_KEY}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(300000),
  })
  const payload = await res.text()
  if (!res.ok) throw new Error(`Local transcription failed: ${res.status} ${payload.slice(0, 200)}`)
  try {
    const json = JSON.parse(payload) as { text?: unknown }
    return cleanText(typeof json.text === 'string' ? json.text : '')
  } catch {
    return cleanText(payload)
  }
}

async function fetchAudio(audioUrl: string): Promise<{ bytes: ArrayBuffer; contentType: string | null }> {
  const maxBytes = maxAudioBytes()
  const head = await fetch(audioUrl, { method: 'HEAD', signal: AbortSignal.timeout(15000) }).catch(() => null)
  const contentLength = head?.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Audio is larger than TRANSCRIPTION_MAX_AUDIO_MB (${Math.ceil(Number(contentLength) / 1024 / 1024)} MB).`)
  }

  const res = await fetch(audioUrl, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`)
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Audio is larger than TRANSCRIPTION_MAX_AUDIO_MB (${Math.ceil(bytes.byteLength / 1024 / 1024)} MB).`)
  }
  return { bytes, contentType: res.headers.get('content-type') }
}

function transcriptionEndpoint(base: string): string {
  const parsed = new URL(base.endsWith('/') ? base : `${base}/`)
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/audio/transcriptions`
  return parsed.href
}

function filenameForAudio(audioUrl: string, contentType: string | null): string {
  try {
    const name = new URL(audioUrl).pathname.split('/').filter(Boolean).pop()
    if (name) return name
  } catch {}
  if (contentType?.includes('wav')) return 'episode.wav'
  if (contentType?.includes('mp4')) return 'episode.m4a'
  return 'episode.mp3'
}

function maxAudioBytes(): number {
  const mb = Number.parseInt(process.env.TRANSCRIPTION_MAX_AUDIO_MB || '', 10)
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_AUDIO_MB) * 1024 * 1024
}

function textTag(xml: string, tag: string): string {
  const value = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || ''
  return cleanText(decodeXml(value.replace(/^<!\[CDATA\[|\]\]>$/g, '')))
}

function normalize(value: string): string {
  return cleanText(value).toLowerCase()
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

export const __mediaTranscriptionTest = {
  applePodcastIds,
  audioFromRss,
  transcriptionEndpoint,
  directAudioUrl,
  isLikelyFeedUrl,
}
