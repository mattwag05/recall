// Locks the two link paths added to the Markdown renderer: "01:34" timestamps
// that deep-link into a card's source, and entity/card labels that link to their
// card. Both feed dangerouslySetInnerHTML, so half of this file is the proof
// that neither path can smuggle markup or a javascript: URL past DOMPurify.
//
// Pure check script — no DB, no server, no AI. Safe for `npm test`.
import assert from 'node:assert/strict'
import { renderMarkdown, renderReader } from '../lib/markdown-render'
import { sourceTimestampHref, timestampSeconds } from '../lib/media-timestamps'

let passed = 0
let failed = 0

function check(label: string, fn: () => void) {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL: ${label}\n  ${err instanceof Error ? err.message : String(err)}`)
  }
}

const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const PODCAST = 'https://soundcloud.com/show/episode-42'
const ARTICLE = 'https://example.com/post'

// ── seconds math ─────────────────────────────────────────────────────

check('mm:ss is minutes and seconds', () => {
  assert.equal(timestampSeconds('01', '34'), 94)
  assert.equal(timestampSeconds('00', '00'), 0)
})

check('hh:mm:ss is hours, minutes and seconds', () => {
  assert.equal(timestampSeconds('00', '05', '47'), 347)
  assert.equal(timestampSeconds('01', '02', '03'), 3723)
})

// ── href shape per platform ──────────────────────────────────────────

check('youtube timestamps use the t=<n>s query param', () => {
  const href = sourceTimestampHref(YOUTUBE, 94)
  assert.ok(href, 'expected a href')
  assert.match(href, /[?&]t=94s(&|$)/)
  assert.match(href, /v=dQw4w9WgXcQ/)
})

check('youtu.be short links are classified as youtube too', () => {
  assert.match(String(sourceTimestampHref('https://youtu.be/abc123', 30)), /[?&]t=30s/)
})

check('other media sources fall back to a #t= media fragment', () => {
  assert.equal(sourceTimestampHref(PODCAST, 347), 'https://soundcloud.com/show/episode-42#t=347')
})

check('a plain article gets no seek link at all', () => {
  // "the 9:15 standup" in an article body must not become a link into the page.
  assert.equal(sourceTimestampHref(ARTICLE, 347), null)
  assert.doesNotMatch(renderMarkdown('the 9:15 standup', { sourceUrl: ARTICLE }), /<a /)
})

check('no source, non-http source, or negative offset yields no href', () => {
  assert.equal(sourceTimestampHref(null, 10), null)
  assert.equal(sourceTimestampHref('', 10), null)
  assert.equal(sourceTimestampHref('javascript:alert(1)', 10), null)
  assert.equal(sourceTimestampHref('not a url', 10), null)
  assert.equal(sourceTimestampHref(ARTICLE, -1), null)
})

// ── timestamps in rendered content ───────────────────────────────────

check('a bullet timestamp becomes a link into the source', () => {
  const out = renderMarkdown('- 01:34 the good part', { sourceUrl: YOUTUBE })
  assert.match(out, /<a href="[^"]*t=94s"[^>]*>01:34<\/a>/)
  assert.match(out, /the good part/)
})

check('hh:mm:ss timestamps link at the right offset', () => {
  const out = renderMarkdown('At 00:05:47 they change topic.', { sourceUrl: PODCAST })
  assert.match(out, /<a href="https:\/\/soundcloud\.com\/show\/episode-42#t=347"[^>]*>00:05:47<\/a>/)
})

check('timestamps render in the Reader too', () => {
  const out = renderReader('Intro\n\n02:00 second section', { sourceUrl: PODCAST })
  assert.match(out, /<a href="https:\/\/soundcloud\.com\/show\/episode-42#t=120"[^>]*>02:00<\/a>/)
})

check('without a source URL a timestamp stays plain text', () => {
  const out = renderMarkdown('- 01:34 the good part', {})
  assert.doesNotMatch(out, /<a /)
  assert.match(out, /01:34/)
})

check('timestamps inside an existing link are left alone', () => {
  const out = renderMarkdown('[01:34](https://elsewhere.test/x)', { sourceUrl: YOUTUBE })
  assert.match(out, /href="https:\/\/elsewhere\.test\/x"/)
  assert.doesNotMatch(out, /t=94s/)
})

check('timestamps inside code spans are left alone', () => {
  const out = renderMarkdown('`01:34`', { sourceUrl: YOUTUBE })
  assert.doesNotMatch(out, /t=94s/)
})

check('a bare number pair that is not a timestamp is not linked', () => {
  const out = renderMarkdown('ratio 1:2:3:4 holds', { sourceUrl: PODCAST })
  assert.doesNotMatch(out, /<a /)
})

// ── entity / card links ──────────────────────────────────────────────

const ENTITY_CONTEXT = { entityCards: [{ label: 'Spaced repetition', cardId: 'ckcard123' }] }

check('a [[wiki link]] resolves to its card', () => {
  const out = renderMarkdown('See [[Spaced repetition]] for more.', ENTITY_CONTEXT)
  assert.match(out, /<a href="\/item\/ckcard123">Spaced repetition<\/a>/)
})

check('an unresolved [[wiki link]] stays literal', () => {
  const out = renderMarkdown('See [[Nothing here]] for more.', ENTITY_CONTEXT)
  assert.doesNotMatch(out, /<a /)
  assert.match(out, /\[\[Nothing here\]\]/)
})

check('a prose mention of a known entity links to its card', () => {
  const out = renderMarkdown('Spaced repetition beats cramming.', ENTITY_CONTEXT)
  assert.match(out, /<a href="\/item\/ckcard123">Spaced repetition<\/a>/)
})

check('only the first mention per label is linked', () => {
  const out = renderMarkdown('Spaced repetition works. Spaced repetition really works.', ENTITY_CONTEXT)
  assert.equal((out.match(/<a href="\/item\/ckcard123">/g) ?? []).length, 1)
})

check('a wiki link claims the label, so a later prose mention is not linked twice', () => {
  const out = renderMarkdown('See [[Spaced repetition]]. Spaced repetition works.', ENTITY_CONTEXT)
  assert.equal((out.match(/<a href="\/item\/ckcard123">/g) ?? []).length, 1)
})

check('entity mentions inside an existing link are not nested', () => {
  const out = renderMarkdown('[Spaced repetition](https://example.com/sr)', ENTITY_CONTEXT)
  assert.equal((out.match(/<a /g) ?? []).length, 1)
  assert.match(out, /href="https:\/\/example\.com\/sr"/)
})

check('a partial word is not treated as an entity mention', () => {
  const out = renderMarkdown('unspaced repetitions', ENTITY_CONTEXT)
  assert.doesNotMatch(out, /<a /)
})

check('very short labels are not linked in prose but still work as wiki links', () => {
  const short = { entityCards: [{ label: 'AI', cardId: 'ckshort1' }] }
  assert.doesNotMatch(renderMarkdown('AI is everywhere', short), /<a /)
  assert.match(renderMarkdown('[[AI]] is everywhere', short), /<a href="\/item\/ckshort1">AI<\/a>/)
})

// ── injection through the new link paths ─────────────────────────────

check('a javascript: source URL produces no timestamp link', () => {
  const out = renderMarkdown('- 01:34 payload', { sourceUrl: 'javascript:alert(1)' })
  assert.doesNotMatch(out, /javascript:/)
  assert.doesNotMatch(out, /<a /)
})

check('a source URL with a quote cannot break out of the href attribute', () => {
  const out = renderMarkdown('- 01:34 payload', { sourceUrl: 'https://soundcloud.com/a"onmouseover="alert(1)' })
  // The quote is percent-encoded, so the payload stays inside the href value and
  // no event-handler attribute is ever produced.
  assert.match(out, /href="[^"]*%22onmouseover=%22/)
  assert.doesNotMatch(out, /<a[^>]*\son\w+\s*=/i)
})

check('an entity label carrying markup is escaped, never rendered', () => {
  const context = { entityCards: [{ label: '<img src=x onerror=alert(1)>', cardId: 'ckevil01' }] }
  const out = renderMarkdown('<img src=x onerror=alert(1)> in prose', context)
  assert.doesNotMatch(out, /<img/i)
  assert.doesNotMatch(out, /<[a-z]+[^>]*\son\w+\s*=/i)
})

check('a wiki title carrying markup is escaped, never rendered', () => {
  const context = { entityCards: [{ label: '<b>bold</b>', cardId: 'ckevil02' }] }
  const out = renderMarkdown('[[<b>bold</b>]]', context)
  assert.doesNotMatch(out, /<b>/i)
})

check('a card id that is not an opaque token yields no link', () => {
  for (const cardId of ['../../etc/passwd', 'a"onmouseover="x', 'javascript:alert(1)', 'a b']) {
    const out = renderMarkdown('[[Spaced repetition]]', { entityCards: [{ label: 'Spaced repetition', cardId }] })
    assert.doesNotMatch(out, /<a /, `cardId ${cardId} must not produce a link`)
    assert.doesNotMatch(out, /javascript:/)
  }
})

check('script payloads are still stripped when a link context is supplied', () => {
  const out = renderMarkdown('<script>alert(1)</script> 01:34', { sourceUrl: YOUTUBE, ...ENTITY_CONTEXT })
  assert.doesNotMatch(out, /<script/i)
})

check('reader link context does not reopen raw HTML', () => {
  const out = renderReader('<svg onload=alert(1)> 01:34', { sourceUrl: YOUTUBE })
  assert.doesNotMatch(out, /<svg/i)
  assert.doesNotMatch(out, /<[a-z]+[^>]*\son\w+\s*=/i)
})

// ── unchanged without a context ──────────────────────────────────────

check('rendering without a link context is unchanged', () => {
  assert.equal(renderMarkdown('- 01:34 the good part'), renderMarkdown('- 01:34 the good part', {}))
  assert.match(renderMarkdown('## Hello World'), /<h2 id="hello-world">Hello World<\/h2>/)
})

console.log(`\nMarkdown link rendering: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
