import assert from 'node:assert/strict'
import { __mediaTranscriptionTest, transcribeMediaPage } from '../lib/media-transcription'

const ids = __mediaTranscriptionTest.applePodcastIds('https://podcasts.apple.com/us/podcast/show-name/id123456789?i=987654321')
assert.deepEqual(ids, { podcastId: '123456789', episodeId: '987654321' })

const rss = `
  <rss><channel>
    <item><title>Old episode</title><enclosure url="https://cdn.example.com/old.mp3" type="audio/mpeg" /></item>
    <item><title><![CDATA[Target &amp; episode]]></title><enclosure url="https://cdn.example.com/audio.mp3?x=1&amp;y=2" type="audio/mpeg" /></item>
  </channel></rss>
`
assert.deepEqual(__mediaTranscriptionTest.audioFromRss(rss, 'Target & episode'), {
  audioUrl: 'https://cdn.example.com/audio.mp3?x=1&y=2',
  title: 'Target & episode',
})

assert.equal(
  __mediaTranscriptionTest.transcriptionEndpoint('http://127.0.0.1:9000/v1'),
  'http://127.0.0.1:9000/v1/audio/transcriptions',
)

// Pure detection helpers (broader transcription routing).
assert.equal(__mediaTranscriptionTest.directAudioUrl('https://cdn.example.com/show/ep1.mp3'), 'https://cdn.example.com/show/ep1.mp3')
assert.equal(__mediaTranscriptionTest.directAudioUrl('https://cdn.example.com/ep.m4a?token=abc'), 'https://cdn.example.com/ep.m4a?token=abc')
assert.equal(__mediaTranscriptionTest.directAudioUrl('https://example.com/article'), null)
assert.equal(__mediaTranscriptionTest.directAudioUrl('not a url'), null)
assert.equal(__mediaTranscriptionTest.isLikelyFeedUrl('https://feeds.example.com/show.rss'), true)
assert.equal(__mediaTranscriptionTest.isLikelyFeedUrl('https://feeds.example.com/show.xml'), true)
assert.equal(__mediaTranscriptionTest.isLikelyFeedUrl('https://example.com/blog/feed/'), true)
assert.equal(__mediaTranscriptionTest.isLikelyFeedUrl('https://example.com/article'), false)

const originalFetch = globalThis.fetch
process.env.TRANSCRIPTION_BASE_URL = 'http://127.0.0.1:9000/v1'
process.env.TRANSCRIPTION_MODEL = 'tiny'

main().catch(err => {
  globalThis.fetch = originalFetch
  throw err
})

async function main() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://itunes.apple.com/lookup')) {
      return json({
        results: [
          { feedUrl: 'https://feeds.example.com/show.xml' },
          { wrapperType: 'podcastEpisode', trackId: 987654321, trackName: 'Target & episode' },
        ],
      })
    }
    if (url === 'https://feeds.example.com/show.xml') {
      return text(rss)
    }
    const audioUrls = ['https://cdn.example.com/audio.mp3?x=1&y=2', 'https://cdn.example.com/direct/ep.mp3', 'https://cdn.example.com/old.mp3']
    if (audioUrls.includes(url) && init?.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-length': '4' } })
    }
    if (audioUrls.includes(url)) {
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    if (url === 'https://feeds.example.com/generic.rss') {
      return text(rss)
    }
    if (url === 'http://127.0.0.1:9000/v1/audio/transcriptions') {
      return json({ text: 'This is a locally transcribed podcast episode with enough text to pass the minimum transcript length check. '.repeat(2) })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch

  const transcript = await transcribeMediaPage('https://podcasts.apple.com/us/podcast/show-name/id123456789?i=987654321', 'apple-podcasts')
  assert.equal(transcript?.source, 'apple-podcasts-transcription')
  assert.equal(transcript?.audioUrl, 'https://cdn.example.com/audio.mp3?x=1&y=2')
  assert.match(transcript?.text ?? '', /locally transcribed podcast episode/)

  // Direct audio URL: transcribe the file as-is.
  const direct = await transcribeMediaPage('https://cdn.example.com/direct/ep.mp3', 'direct-audio')
  assert.equal(direct?.source, 'direct-audio-transcription')
  assert.equal(direct?.audioUrl, 'https://cdn.example.com/direct/ep.mp3')

  // Generic RSS feed: take the first enclosure, then transcribe.
  const feed = await transcribeMediaPage('https://feeds.example.com/generic.rss', 'podcast-rss')
  assert.equal(feed?.source, 'podcast-rss-transcription')
  assert.equal(feed?.audioUrl, 'https://cdn.example.com/old.mp3')

  // Unsupported platforms return null (no reliable audio resolution).
  assert.equal(await transcribeMediaPage('https://soundcloud.com/x/y', 'soundcloud'), null)

  globalThis.fetch = originalFetch
  console.log('media transcription checks passed')
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function text(value: string): Response {
  return new Response(value, { status: 200, headers: { 'content-type': 'text/xml' } })
}
