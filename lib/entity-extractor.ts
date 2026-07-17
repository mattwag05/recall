export interface ExtractedEntities {
  hashtags: string[]
  mentions: string[]
  urls: string[]
  toolNames: string[]  // derived from URL domains
}

export function extractEntities(text: string): ExtractedEntities {
  const hashtags = [...(text.match(/#[\w]+/g) ?? [])].map(h => h.slice(1).toLowerCase())
  const mentions = [...(text.match(/@[\w.]+/g) ?? [])].map(m => m.slice(1).toLowerCase())
  const urlMatches = [...(text.match(/https?:\/\/[^\s]+/g) ?? [])]
  const toolNames = urlMatches.map(url => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '')
      return host.split('.')[0]
    } catch { return '' }
  }).filter(Boolean)

  return {
    hashtags: [...new Set(hashtags)],
    mentions: [...new Set(mentions)],
    urls: urlMatches,
    toolNames: [...new Set(toolNames)],
  }
}
