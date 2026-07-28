// SSRF guard shared by every import path that fetches a user-supplied URL.
// Previously copy-pasted into four route files; keeping one copy means a fix
// to the private-range logic reaches all of them.

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '0.0.0.0' || host === '169.254.169.254') return true
  if (host.includes(':') && (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) {
    return true
  }

  const octets = host.split('.')
  if (octets.length !== 4 || octets.some(part => !/^\d+$/.test(part))) return false
  const parts = octets.map(part => Number.parseInt(part, 10))
  if (parts.some(part => part < 0 || part > 255)) return false
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

/**
 * `noun` names the thing being imported in the user-facing errors, e.g.
 * 'bookmarks' -> "Only http and https bookmarks can be imported."
 * `malformedNoun` names it in the parse failure, e.g. 'Bookmark' -> "Bookmark URL is malformed."
 */
export function validatePublicHttpUrl(
  rawUrl: string,
  noun: string,
  malformedNoun: string,
): { url: URL; error?: never } | { url?: never; error: string } {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: `Only http and https ${noun} can be imported.` }
    }
    if (isPrivateHostname(parsed.hostname)) {
      return { error: `Recall blocks localhost, private network, and internal IP ${noun} for local safety.` }
    }
    return { url: parsed }
  } catch {
    return { error: `${malformedNoun} URL is malformed.` }
  }
}
