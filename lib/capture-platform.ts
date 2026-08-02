// Pure URL -> capture-platform classification.
//
// Split out of lib/url-capture.ts so the browser can reuse the exact same
// classification the capture pipeline ran (Reader/Notebook timestamp links need
// to know a card is YouTube). url-capture.ts pulls in jsdom + Readability +
// node:crypto, none of which can be bundled into a client component.

import { directAudioUrl, isLikelyFeedUrl } from './media-transcription'

export type CaptureProvider = {
  platform: string
  sourceType: 'url' | 'media'
  mediaType?: 'audio' | 'video'
}

export function classifyCaptureUrl(url: string): CaptureProvider {
  const hostname = hostForUrl(url)
  if (hostname === 'youtu.be' || hostMatches(hostname, 'youtube.com')) {
    return { platform: 'youtube', sourceType: 'media', mediaType: 'video' }
  }
  if (hostMatches(hostname, 'vimeo.com')) {
    return { platform: 'vimeo', sourceType: 'media', mediaType: 'video' }
  }
  if (hostMatches(hostname, 'tiktok.com')) {
    return { platform: 'tiktok', sourceType: 'media', mediaType: 'video' }
  }
  if (hostMatches(hostname, 'spotify.com')) {
    return { platform: 'spotify', sourceType: 'media', mediaType: 'audio' }
  }
  if (hostMatches(hostname, 'podcasts.apple.com')) {
    return { platform: 'apple-podcasts', sourceType: 'media', mediaType: 'audio' }
  }
  if (hostMatches(hostname, 'soundcloud.com')) {
    return { platform: 'soundcloud', sourceType: 'media', mediaType: 'audio' }
  }
  if (hostMatches(hostname, 'bandcamp.com')) {
    return { platform: 'bandcamp', sourceType: 'media', mediaType: 'audio' }
  }
  if (hostMatches(hostname, 'threads.net')) return { platform: 'threads', sourceType: 'url' }
  if (hostMatches(hostname, 'instagram.com')) return { platform: 'instagram', sourceType: 'url' }
  if (hostMatches(hostname, 'reddit.com')) return { platform: 'reddit', sourceType: 'url' }
  // Direct audio files + generic podcast/RSS feeds (any host) are transcribable.
  if (directAudioUrl(url)) return { platform: 'direct-audio', sourceType: 'media', mediaType: 'audio' }
  if (isLikelyFeedUrl(url)) return { platform: 'podcast-rss', sourceType: 'media', mediaType: 'audio' }
  return { platform: 'web', sourceType: 'url' }
}

function hostForUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}
