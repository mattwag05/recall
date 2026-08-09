// Guards the shared SSRF check used by every URL-fetching import route.
// Before this was one module it was four copies, so a gap could be fixed in
// one route and silently left open in the other three.
import assert from 'node:assert/strict'
import { isPrivateHostname, validatePublicHttpUrl, safeFetch } from '../lib/url-safety'

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

const BLOCKED = [
  'localhost', 'LOCALHOST', 'app.localhost', 'printer.local',
  '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.169.254', '169.254.1.1',
  '10.0.0.1', '10.255.255.255', '192.168.1.1', '192.168.0.254',
  '172.16.0.1', '172.20.10.5', '172.31.255.255',
  '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1',
  // Bracketed IPv6 literals — the form URL.hostname actually returns, so the
  // bare-string checks above never saw real traffic (SSRF vuln-0001).
  '[::1]', '[fe80::1]', '[fc00::1]', '[::]', '::',
  // IPv4-mapped IPv6 defeats both the IPv6 and dotted-IPv4 checks; decode the
  // embedded IPv4 and re-test it. Dotted and hex-group forms, bracketed or not.
  '::ffff:127.0.0.1', '[::ffff:127.0.0.1]', '[::ffff:169.254.169.254]',
  '::ffff:7f00:1', '[::ffff:c0a8:0001]', '::ffff:10.0.0.1', '::127.0.0.1',
]

const ALLOWED = [
  'example.com', 'sub.example.co.uk', 'threads.net', '8.8.8.8', '1.1.1.1',
  '172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1', '169.253.0.1',
  'notlocalhost.com', 'local.example.com',
  // Public IPv6 (incl. bracketed) and mapped-public must still be allowed.
  '2606:4700::1111', '[2606:4700::1111]', '::ffff:8.8.8.8', '[::ffff:8.8.8.8]',
]

for (const host of BLOCKED) {
  check(`blocks ${host}`, () => assert.equal(isPrivateHostname(host), true))
}
for (const host of ALLOWED) {
  check(`allows ${host}`, () => assert.equal(isPrivateHostname(host), false))
}

check('rejects non-http protocols', () => {
  const result = validatePublicHttpUrl('file:///etc/passwd', 'bookmarks', 'Bookmark')
  assert.equal(result.url, undefined)
  assert.match(result.error!, /^Only http and https bookmarks/)
})

check('rejects private hosts through the URL path', () => {
  const result = validatePublicHttpUrl('http://192.168.1.1/admin', 'Pocket links', 'Pocket')
  assert.equal(result.url, undefined)
  assert.match(result.error!, /blocks localhost/)
})

check('rejects malformed URLs with the caller noun', () => {
  const result = validatePublicHttpUrl('not a url', 'bookmarks', 'Bookmark')
  assert.equal(result.error, 'Bookmark URL is malformed.')
})

check('accepts a public https URL', () => {
  const result = validatePublicHttpUrl('https://example.com/post', 'bookmarks', 'Bookmark')
  assert.equal(result.error, undefined)
  assert.equal(result.url?.hostname, 'example.com')
})

async function acheck(label: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL: ${label}\n  ${err instanceof Error ? err.message : String(err)}`)
  }
}

void (async () => {
  // safeFetch must re-validate every redirect hop, not just the initial URL.
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response(null, { status: 302, headers: { location: 'http://[::ffff:127.0.0.1]:8000/' } })
  }) as typeof fetch
  await acheck('safeFetch blocks a 302 redirect to a private (mapped-IPv6 loopback) host', async () => {
    await assert.rejects(safeFetch('https://example.com/start'), /private or internal/)
    assert.equal(calls, 1, 'must stop at the redirect, not fetch the private target')
  })
  await acheck('safeFetch rejects an initial private URL before fetching', async () => {
    await assert.rejects(safeFetch('http://127.0.0.1:8000/'), /private or internal/)
  })
  globalThis.fetch = realFetch

  console.log(`\nURL safety: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})()
