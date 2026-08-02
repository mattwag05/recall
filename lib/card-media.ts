// MediaItem rows attached to a card, as the card-detail image gallery sees them.
//
// The gallery renders locally-stored files first: lib/media-storage.ts writes
// them under public/media/<localPath>, so `/media/<localPath>` serves them
// without a network round trip to the original host.

export interface CardMedia {
  id: string
  type: string
  url: string
  thumbnailUrl: string | null
  localPath: string | null
}

export function parseCardMedia(value: unknown): CardMedia[] {
  if (!Array.isArray(value)) return []
  const media: CardMedia[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.url !== 'string') continue
    media.push({
      id: record.id,
      type: typeof record.type === 'string' ? record.type : 'image',
      url: record.url,
      thumbnailUrl: typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl : null,
      localPath: typeof record.localPath === 'string' ? record.localPath : null,
    })
  }
  return media
}

/** Same traversal guard as lib/media-storage.ts resolveMediaPath, on the client side. */
export function localMediaSrc(localPath: string | null): string | null {
  if (!localPath) return null
  const parts = localPath.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0 || parts.includes('..') || localPath.startsWith('/')) return null
  return `/media/${parts.map(encodeURIComponent).join('/')}`
}

export function cardMediaSrc(item: CardMedia): string | null {
  const local = localMediaSrc(item.localPath)
  if (local) return local
  return httpSrc(item.thumbnailUrl) ?? httpSrc(item.url)
}

/** Only the media that can actually be shown as a picture in the gallery. */
export function galleryImages(media: CardMedia[]): CardMedia[] {
  return media.filter(item => item.type !== 'video' && item.type !== 'audio' && cardMediaSrc(item) !== null)
}

function httpSrc(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
