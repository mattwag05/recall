import { createHash } from 'crypto'
import { extractArticle, extractPageMetadata, providerFromUrl, type ExtractedArticle, type PageMetadata } from '@/lib/extract/article'
import { transcribeMediaPage, transcriptionConfigured } from '@/lib/media-transcription'
import { classifyCaptureUrl, type CaptureProvider } from '@/lib/capture-platform'

// Classification lives in lib/capture-platform.ts so client components can share
// it; this module is server-only (jsdom, Readability, node:crypto).
export { classifyCaptureUrl }
export type { CaptureProvider }

export type CaptureStatus = 'organizing' | 'failed'

export type CaptureResult = {
  postId: string
  legacyPostId: string
  platform: string
  provider: string
  title: string
  text: string
  body: string | null
  thumbnail: string | null
  sourceType: 'url' | 'media'
  status: CaptureStatus
  extracted: boolean
  message?: string
  rawJson: Record<string, unknown>
  mediaItem?: {
    type: 'audio' | 'video'
    url: string
    thumbnailUrl: string | null
  }
}

const MEDIA_READER_TEXT_MIN_CHARS = 500

const FAILED_CAPTURE_MESSAGE =
  'Saved as failed — open the card and use Retry extraction after checking the page is reachable.'

const MEDIA_METADATA_CAPTURE_MESSAGE =
  'Media page saved with source metadata. Retry extraction later if captions or local transcription become available.'

const YOUTUBE_TRANSCRIPT_MIN_CHARS = 120

export function generatePostIdFromUrl(url: string): string {
  return createHash('sha256').update(url).digest('base64url')
}

export function generateLegacyPostIdFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const pathSegments = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean)
    const idBase = pathSegments.slice(-2).join('_') || parsed.hostname
    return Buffer.from(idBase).toString('base64url').slice(0, 32)
  } catch {
    return Buffer.from(url).toString('base64url').slice(0, 32)
  }
}

export async function captureUrl(url: string): Promise<CaptureResult> {
  const provider = providerFromUrl(url)
  const classification = classifyCaptureUrl(url)
  const postId = generatePostIdFromUrl(url)
  const legacyPostId = generateLegacyPostIdFromUrl(url)
  let article: ExtractedArticle | null = null
  let metadata: PageMetadata | null = null
  let extractionError: string | null = null

  try {
    article = await extractArticle(url)
  } catch (err) {
    extractionError = String(err)
  }

  if (!article) {
    try {
      metadata = await extractPageMetadata(url)
    } catch (err) {
      extractionError = extractionError ? `${extractionError}; metadata ${String(err)}` : String(err)
    }
  }

  const title = (article?.title || metadata?.title || url).trim()
  const description = cleanText(article?.excerpt || metadata?.description || '')
  const readerContent = cleanText(article?.textContent || '')
  const thumbnail = article?.leadImage || metadata?.leadImage || null
  let transcript: YouTubeTranscript | null = null
  let transcriptError: string | null = null
  let localTranscript: Awaited<ReturnType<typeof transcribeMediaPage>> = null
  let localTranscriptError: string | null = null

  if (classification.platform === 'youtube') {
    try {
      transcript = await fetchYouTubeTranscript(url)
    } catch (err) {
      transcriptError = String(err)
    }
  }

  if (!transcript && classification.sourceType === 'media' && classification.platform !== 'youtube') {
    try {
      localTranscript = await transcribeMediaPage(url, classification.platform)
    } catch (err) {
      localTranscriptError = String(err)
    }
  }

  if (transcript && transcript.text.length >= YOUTUBE_TRANSCRIPT_MIN_CHARS) {
    return {
      postId,
      legacyPostId,
      platform: classification.platform,
      provider,
      title,
      text: description || transcript.text.slice(0, 280) || title,
      body: transcript.text,
      thumbnail,
      sourceType: 'media',
      status: 'organizing',
      extracted: true,
      rawJson: {
        postId,
        platform: classification.platform,
        url,
        provider,
        captureMode: 'media-transcript',
        transcriptAvailable: true,
        transcriptSource: 'youtube-captions',
        transcriptLanguage: transcript.languageCode,
        transcriptTrackName: transcript.trackName,
        transcriptKind: transcript.kind,
        transcriptSegmentCount: transcript.segmentCount,
      },
      mediaItem: classification.mediaType ? { type: classification.mediaType, url, thumbnailUrl: thumbnail } : undefined,
    }
  }

  if (localTranscript) {
    const transcriptText = localTranscript.text
    return {
      postId,
      legacyPostId,
      platform: classification.platform,
      provider,
      title: localTranscript.title || title,
      text: description || transcriptText.slice(0, 280) || title,
      body: transcriptText,
      thumbnail,
      sourceType: 'media',
      status: 'organizing',
      extracted: true,
      rawJson: {
        postId,
        platform: classification.platform,
        url,
        provider,
        captureMode: 'media-transcript',
        transcriptAvailable: true,
        transcriptSource: localTranscript.source,
        transcriptAudioUrl: localTranscript.audioUrl,
      },
      mediaItem: classification.mediaType ? { type: classification.mediaType, url, thumbnailUrl: thumbnail } : undefined,
    }
  }

  const mediaReaderAvailable = classification.sourceType === 'media' && readerContent.length >= MEDIA_READER_TEXT_MIN_CHARS
  const articleReaderAvailable = classification.sourceType === 'url' && readerContent.length > 0
  const hasReaderContent = articleReaderAvailable || mediaReaderAvailable

  if (hasReaderContent) {
    return {
      postId,
      legacyPostId,
      platform: classification.platform,
      provider,
      title,
      text: description || readerContent.slice(0, 280) || title,
      body: readerContent,
      thumbnail,
      sourceType: classification.sourceType,
      status: 'organizing',
      extracted: true,
      rawJson: {
        postId,
        platform: classification.platform,
        url,
        provider,
        captureMode: classification.sourceType === 'media' ? 'media-reader' : 'article-reader',
      },
      mediaItem: classification.mediaType ? { type: classification.mediaType, url, thumbnailUrl: thumbnail } : undefined,
    }
  }

  if (classification.sourceType === 'media' && (article || metadata) && (title || description || thumbnail)) {
    return {
      postId,
      legacyPostId,
      platform: classification.platform,
      provider,
      title,
      text: description || `Saved ${classification.platform} page. Open the source link for playback.`,
      body: null,
      thumbnail,
      sourceType: 'media',
      status: 'organizing',
      extracted: true,
      message: MEDIA_METADATA_CAPTURE_MESSAGE,
      rawJson: {
        postId,
        platform: classification.platform,
        url,
        provider,
        captureMode: 'media-metadata',
        transcriptAvailable: false,
        transcriptError,
        localTranscriptConfigured: transcriptionConfigured(),
        localTranscriptError,
        extractionError,
      },
      mediaItem: classification.mediaType ? { type: classification.mediaType, url, thumbnailUrl: thumbnail } : undefined,
    }
  }

  return {
    postId,
    legacyPostId,
    platform: classification.platform,
    provider,
    title,
    text: description || title || url,
    body: null,
    thumbnail,
    sourceType: classification.sourceType,
    status: 'failed',
    extracted: false,
    message: FAILED_CAPTURE_MESSAGE,
    rawJson: {
      postId,
      platform: classification.platform,
      url,
      provider,
      captureMode: classification.sourceType === 'media' ? 'media-failed' : 'article-failed',
      ...(classification.platform === 'youtube' ? { transcriptError } : {}),
      localTranscriptConfigured: transcriptionConfigured(),
      localTranscriptError,
      extractionError,
    },
    mediaItem: classification.mediaType ? { type: classification.mediaType, url, thumbnailUrl: thumbnail } : undefined,
  }
}

type YouTubeTranscript = {
  text: string
  languageCode: string
  trackName: string
  kind: string | null
  segmentCount: number
}

type YouTubeCaptionTrack = {
  baseUrl?: string
  languageCode?: string
  kind?: string
  name?: {
    simpleText?: string
    runs?: Array<{ text?: string }>
  }
}

type YouTubePlayerResponse = {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YouTubeCaptionTrack[]
    }
  }
}

type TranscriptJson = {
  events?: Array<{
    segs?: Array<{
      utf8?: string
    }>
  }>
}

async function fetchYouTubeTranscript(url: string): Promise<YouTubeTranscript | null> {
  const htmlRes = await fetch(url, {
    headers: mediaFetchHeaders(),
    signal: AbortSignal.timeout(15000),
  })
  if (!htmlRes.ok) throw new Error(`youtube page fetch ${htmlRes.status}`)
  const html = await htmlRes.text()
  const playerResponse = extractYouTubePlayerResponse(html)
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!Array.isArray(tracks) || tracks.length === 0) return null

  const track = chooseYouTubeCaptionTrack(tracks)
  if (!track?.baseUrl) return null

  const transcriptUrl = withTranscriptFormat(track.baseUrl)
  const transcriptRes = await fetch(transcriptUrl, {
    headers: mediaFetchHeaders(),
    signal: AbortSignal.timeout(15000),
  })
  if (!transcriptRes.ok) throw new Error(`youtube transcript fetch ${transcriptRes.status}`)
  const payload = await transcriptRes.text()
  const segments = parseTranscriptPayload(payload)
  const text = cleanText(segments.join(' '))
  if (!text) return null

  return {
    text,
    languageCode: track.languageCode || 'unknown',
    trackName: captionTrackName(track) || track.languageCode || 'Transcript',
    kind: track.kind || null,
    segmentCount: segments.length,
  }
}

function mediaFetchHeaders(): HeadersInit {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 Recall/0.1',
    Accept: 'text/html,application/xhtml+xml,application/json,text/xml,*/*',
  }
}

function extractYouTubePlayerResponse(html: string): YouTubePlayerResponse | null {
  const marker = 'ytInitialPlayerResponse'
  const markerIndex = html.indexOf(marker)
  if (markerIndex === -1) return null
  const objectStart = html.indexOf('{', markerIndex)
  if (objectStart === -1) return null
  const json = balancedJsonObject(html, objectStart)
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function balancedJsonObject(value: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < value.length; i += 1) {
    const char = value[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return value.slice(start, i + 1)
    }
  }

  return null
}

function chooseYouTubeCaptionTrack(tracks: YouTubeCaptionTrack[]): YouTubeCaptionTrack | null {
  const withUrl = tracks.filter(track => typeof track.baseUrl === 'string' && track.baseUrl)
  if (withUrl.length === 0) return null
  return (
    withUrl.find(track => isEnglishTrack(track) && track.kind !== 'asr') ||
    withUrl.find(isEnglishTrack) ||
    withUrl.find(track => track.kind !== 'asr') ||
    withUrl[0]
  )
}

function isEnglishTrack(track: YouTubeCaptionTrack): boolean {
  return (track.languageCode || '').toLowerCase().startsWith('en')
}

function captionTrackName(track: YouTubeCaptionTrack): string {
  if (track.name?.simpleText) return track.name.simpleText
  return (track.name?.runs || []).map(run => run.text || '').join('').trim()
}

function withTranscriptFormat(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    if (!parsed.searchParams.has('fmt')) parsed.searchParams.set('fmt', 'json3')
    return parsed.href
  } catch {
    return baseUrl
  }
}

function parseTranscriptPayload(payload: string): string[] {
  const trimmed = payload.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as TranscriptJson
      const events = Array.isArray(parsed.events) ? parsed.events : []
      return events
        .flatMap(event => Array.isArray(event.segs) ? event.segs : [])
        .map(segment => cleanTranscriptSegment(String(segment.utf8 || '')))
        .filter(Boolean)
    } catch {
      return []
    }
  }

  const matches = Array.from(trimmed.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g))
  return matches.map(match => cleanTranscriptSegment(decodeXmlEntities(match[1] || ''))).filter(Boolean)
}

function cleanTranscriptSegment(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

function cleanText(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim()
}

