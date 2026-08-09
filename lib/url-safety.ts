// SSRF guard shared by every import path that fetches a user-supplied URL.
// Previously copy-pasted into four route files; keeping one copy means a fix
// to the private-range logic reaches all of them.

// Decode the IPv4 embedded in an IPv4-mapped/compatible IPv6 literal
// (bracket-stripped, lowercase). Handles dotted (::ffff:127.0.0.1) and
// two-hex-group (::ffff:7f00:1) forms. Returns null if `host` isn't one.
function mappedIpv4(host: string): string | null {
  const m = host.match(/^::(?:ffff:)?([0-9a-f.:]+)$/)
  if (!m) return null
  const tail = m[1]
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = Number.parseInt(hex[1], 16)
    const lo = Number.parseInt(hex[2], 16)
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
  }
  return null
}

export function isPrivateHostname(hostname: string): boolean {
  let host = hostname.toLowerCase()
  // Node's URL parser returns IPv6 literals bracketed ("[::1]"); strip them so
  // the checks below see the address, not "[".
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '0.0.0.0' || host === '169.254.169.254') return true

  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true                     // unspecified / loopback
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
    // IPv4-mapped/compatible IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1, ::127.0.0.1)
    // tunnels an IPv4 target past both the IPv6 and dotted-IPv4 checks. Decode
    // the embedded IPv4 and re-test it (SSRF vuln-0001).
    const mapped = mappedIpv4(host)
    if (mapped) return isPrivateHostname(mapped)
    return false
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

const MAX_REDIRECTS = 5

/**
 * fetch() for user-supplied URLs. Follows redirects manually and re-checks the
 * hostname of every hop, closing the SSRF redirect-revalidation gap: validating
 * only the initial URL let a public URL 302 to a private/internal address.
 * Use this for any fetch of a user-provided URL; do NOT use it for configured
 * internal endpoints (local LLM/TTS) — it blocks localhost by design.
 */
export async function safeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  let current = typeof input === 'string' ? input : input.toString()
  for (let hop = 0; ; hop++) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      throw new Error('safeFetch: malformed URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('safeFetch: refusing non-http(s) URL')
    }
    if (isPrivateHostname(parsed.hostname)) {
      throw new Error('safeFetch: refusing request to a private or internal address')
    }
    // redirect:'manual' on the server (undici) yields the real 3xx + Location,
    // not a browser-style opaque response, so we can revalidate the next hop.
    const res = await fetch(current, { ...init, redirect: 'manual' })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    if (hop >= MAX_REDIRECTS) throw new Error('safeFetch: too many redirects')
    current = new URL(location, parsed).toString()
  }
}
