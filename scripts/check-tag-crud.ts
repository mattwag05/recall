// Locks the tag CRUD guards: slug derivation, name validation, and the
// re-parent cycle check that keeps the tag tree a tree. Pure functions from
// lib/tags — no DB, no server.
import assert from 'node:assert/strict'
import { parseTagName, slugifyTag, tagColor, wouldCycle, TAG_PALETTE } from '../lib/tags'

let passed = 0
let failed = 0

function check(label: string, fn: () => void) {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL: ${label}\n  ${err instanceof Error ? err.message : JSON.stringify(err)}`)
  }
}

// ── slugs ───────────────────────────────────────────────────────────────────

check('slug lowercases and hyphenates', () => {
  assert.equal(slugifyTag('Machine Learning'), 'machine-learning')
})

check('slug strips punctuation and collapses separators', () => {
  assert.equal(slugifyTag('  AI / Agents!!  '), 'ai-agents')
})

check('slug never starts or ends with a hyphen', () => {
  for (const name of ['---AI---', '!!!', ' - x - ']) {
    const slug = slugifyTag(name)
    assert.ok(!slug.startsWith('-') && !slug.endsWith('-'), `bad slug for ${name}: ${slug}`)
  }
})

check('a name with no alphanumerics slugs to empty, so the route can reject it', () => {
  assert.equal(slugifyTag('!!!'), '')
  assert.equal(slugifyTag('   '), '')
})

check('slug is capped at 50 characters', () => {
  assert.equal(slugifyTag('a'.repeat(120)).length, 50)
})

check('the same name always slugs the same way', () => {
  assert.equal(slugifyTag('Deep Work'), slugifyTag('  deep   work '))
})

// ── names ───────────────────────────────────────────────────────────────────

check('a name is trimmed and inner whitespace collapsed', () => {
  assert.equal(parseTagName('  Deep    Work  '), 'Deep Work')
})

for (const bad of ['', '   ', null, undefined, 42, {}, ['AI'], 'x'.repeat(61)]) {
  check(`rejects name ${JSON.stringify(bad)}`, () => assert.equal(parseTagName(bad), null))
}

check('accepts a 60-character name but not a 61-character one', () => {
  assert.equal(parseTagName('x'.repeat(60)), 'x'.repeat(60))
  assert.equal(parseTagName('x'.repeat(61)), null)
})

// ── colors ──────────────────────────────────────────────────────────────────

check('tag colors cycle through the palette instead of running off the end', () => {
  assert.equal(tagColor(0), TAG_PALETTE[0])
  assert.equal(tagColor(TAG_PALETTE.length), TAG_PALETTE[0])
  assert.equal(tagColor(TAG_PALETTE.length * 3 + 2), TAG_PALETTE[2])
})

// ── re-parenting ────────────────────────────────────────────────────────────

// tech -> ai -> agents ; cooking is a separate root.
const parents = new Map<string, string | null>([
  ['tech', null],
  ['ai', 'tech'],
  ['agents', 'ai'],
  ['cooking', null],
])

check('moving a tag under an unrelated root is allowed', () => {
  assert.equal(wouldCycle(parents, 'agents', 'cooking'), false)
})

check('promoting a tag to the top level is allowed', () => {
  assert.equal(wouldCycle(parents, 'ai', null), false)
})

check('a tag cannot become its own parent', () => {
  assert.equal(wouldCycle(parents, 'ai', 'ai'), true)
})

check('a tag cannot be moved under its own child', () => {
  assert.equal(wouldCycle(parents, 'tech', 'ai'), true)
})

check('a tag cannot be moved under its own grandchild', () => {
  assert.equal(wouldCycle(parents, 'tech', 'agents'), true)
})

check('an already-corrupt cycle terminates instead of hanging', () => {
  const looped = new Map<string, string | null>([['a', 'b'], ['b', 'a']])
  assert.equal(wouldCycle(looped, 'c', 'a'), true)
})

console.log(`\nTag CRUD: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
