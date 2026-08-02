// Turn "01:34" style timestamps in Notebook / Reader text into deep links back
// into the card's source at that second.
//
// Platform comes from classifyCaptureUrl, the same classification the capture
// pipeline ran, rather than a second round of URL sniffing.

import { classifyCaptureUrl } from './capture-platform'

/**
 * mm:ss or hh:mm:ss. The leading group is the preceding character (or start of
 * string) rather than a lookbehind, because tsconfig targets ES2017.
 *
 * Groups: 1 = prefix, 2 = first number, 3 = second number, 4 = optional third.
 */
export const TIMESTAMP_SOURCE = '(^|[^\\d:])(\\d{1,2}):([0-5]\\d)(?::([0-5]\\d))?(?![\\d:])'

/** mm:ss when `third` is absent, hh:mm:ss when it is present. */
export function timestampSeconds(first: string, second: string, third?: string): number | null {
  const a = Number(first)
  const b = Number(second)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (third === undefined) return a * 60 + b
  const c = Number(third)
  if (!Number.isFinite(c)) return null
  return a * 3600 + b * 60 + c
}

/**
 * A link into `sourceUrl` at `seconds`. YouTube takes `&t=<n>s`; other media
 * gets a `#t=<n>` media fragment, which is the best generic fallback.
 *
 * Returns null when there is no usable http(s) source, and for anything the
 * capture pipeline did not classify as media — an article that happens to say
 * "the 9:15 standup" should not sprout a seek link.
 */
export function sourceTimestampHref(sourceUrl: string | null | undefined, seconds: number): string | null {
  if (!sourceUrl || !Number.isFinite(seconds) || seconds < 0) return null
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const capture = classifyCaptureUrl(sourceUrl)
  if (capture.sourceType !== 'media') return null

  const offset = Math.floor(seconds)
  if (capture.platform === 'youtube') {
    url.searchParams.set('t', `${offset}s`)
    return url.href
  }
  url.hash = `t=${offset}`
  return url.href
}
