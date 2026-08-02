// Locks the card-detail two-pane rules and the three browser-persisted
// preferences that back it: the pane layout, the Reader reformat cache, and the
// quiz settings. A fake localStorage is installed so the real read/write paths
// run here rather than only their pure helpers.
//
// Pure check script — no DB, no server, no AI. Safe for `npm test`.
import assert from 'node:assert/strict'
import {
  CARD_TABS,
  DEFAULT_PANE_LAYOUT,
  PANE_LAYOUT_KEY,
  isTabLocked,
  parseCardTab,
  parsePaneLayout,
  readPaneLayout,
  selectPaneTab,
  selectableTabs,
  writePaneLayout,
} from '../lib/pane-layout'
import { parseReformatStore, pruneReformatStore, readReaderReformat, writeReaderReformat } from '../lib/reader-reformat-store'
import { DEFAULT_QUIZ_SETTINGS, parseQuizSettings, normalizeQuizSettings, readQuizSettings, writeQuizSettings } from '../lib/quiz-settings'

// The stores only touch window/localStorage when called, so installing the fakes
// after the imports still exercises the real read/write paths.
const backing = new Map<string, string>()
const fakeStorage = {
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => { backing.set(key, value) },
  removeItem: (key: string) => { backing.delete(key) },
  clear: () => backing.clear(),
  key: (index: number) => [...backing.keys()][index] ?? null,
  get length() { return backing.size },
}
const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
globals.window = globalThis
globals.localStorage = fakeStorage

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

// ── tabs ─────────────────────────────────────────────────────────────

check('exactly the six card tabs', () => {
  assert.deepEqual(CARD_TABS.map(tab => tab.id), ['notebook', 'chat', 'reader', 'quiz', 'connections', 'graph'])
})

check('parseCardTab accepts only real tab ids', () => {
  assert.equal(parseCardTab('reader'), 'reader')
  for (const value of ['', 'Notebook', 'notes', null, undefined, 3, {}]) {
    assert.equal(parseCardTab(value), null, `${JSON.stringify(value)} must not parse`)
  }
})

check('the right pane defaults to chat', () => {
  assert.deepEqual(DEFAULT_PANE_LAYOUT, { left: 'notebook', right: 'chat', rightHidden: false })
})

// ── the invariant: never the same tab in both panes ───────────────────

check('picking the other pane’s tab swaps the two panes', () => {
  const swapped = selectPaneTab(DEFAULT_PANE_LAYOUT, 'left', 'chat')
  assert.equal(swapped.left, 'chat')
  assert.equal(swapped.right, 'notebook')
})

check('picking a free tab leaves the other pane alone', () => {
  const next = selectPaneTab(DEFAULT_PANE_LAYOUT, 'left', 'reader')
  assert.equal(next.left, 'reader')
  assert.equal(next.right, 'chat')
})

check('picking the tab a pane already shows is a no-op', () => {
  assert.equal(selectPaneTab(DEFAULT_PANE_LAYOUT, 'left', 'notebook'), DEFAULT_PANE_LAYOUT)
})

check('no selection can leave both panes on one tab', () => {
  let layout = DEFAULT_PANE_LAYOUT
  for (const pane of ['left', 'right'] as const) {
    for (const tab of CARD_TABS.map(t => t.id)) {
      layout = selectPaneTab(layout, pane, tab)
      assert.notEqual(layout.left, layout.right, `${pane} -> ${tab} collided`)
    }
  }
})

// ── locking ──────────────────────────────────────────────────────────

check('a tab open in the other pane is locked, in two-pane mode only', () => {
  assert.equal(isTabLocked(DEFAULT_PANE_LAYOUT, 'left', 'chat', true), true)
  assert.equal(isTabLocked(DEFAULT_PANE_LAYOUT, 'right', 'notebook', true), true)
  assert.equal(isTabLocked(DEFAULT_PANE_LAYOUT, 'left', 'reader', true), false)
  // Below lg there is one pane, so nothing is locked.
  assert.equal(isTabLocked(DEFAULT_PANE_LAYOUT, 'left', 'chat', false), false)
})

check('keyboard navigation skips the locked tab', () => {
  assert.ok(!selectableTabs(DEFAULT_PANE_LAYOUT, 'left', true).includes('chat'))
  assert.equal(selectableTabs(DEFAULT_PANE_LAYOUT, 'left', true).length, CARD_TABS.length - 1)
  assert.equal(selectableTabs(DEFAULT_PANE_LAYOUT, 'left', false).length, CARD_TABS.length)
})

// ── layout persistence ───────────────────────────────────────────────

check('a round trip through localStorage preserves the layout', () => {
  const layout = { left: 'reader' as const, right: 'graph' as const, rightHidden: true }
  writePaneLayout(layout)
  assert.deepEqual(readPaneLayout(), layout)
})

check('missing, malformed, or unknown stored layouts fall back to the default', () => {
  assert.deepEqual(parsePaneLayout(null), DEFAULT_PANE_LAYOUT)
  assert.deepEqual(parsePaneLayout('not json'), DEFAULT_PANE_LAYOUT)
  assert.deepEqual(parsePaneLayout('[]'), DEFAULT_PANE_LAYOUT)
  assert.deepEqual(parsePaneLayout('{"left":"nope","right":"nope"}'), DEFAULT_PANE_LAYOUT)
})

check('a stored layout with both panes on one tab is repaired, not rendered', () => {
  const repaired = parsePaneLayout('{"left":"reader","right":"reader"}')
  assert.equal(repaired.left, 'reader')
  assert.notEqual(repaired.right, 'reader')
})

check('a corrupt stored value does not throw on read', () => {
  fakeStorage.setItem(PANE_LAYOUT_KEY, '{oops')
  assert.deepEqual(readPaneLayout(), DEFAULT_PANE_LAYOUT)
})

// ── reader reformat cache ────────────────────────────────────────────

check('a reformat survives being written and read back', () => {
  writeReaderReformat('card-a', '# Reformatted\n\nbody')
  assert.equal(readReaderReformat('card-a'), '# Reformatted\n\nbody')
  assert.equal(readReaderReformat('card-missing'), null)
})

check('only the newest few cards are kept', () => {
  const now = Date.now()
  const entries = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`card-${i}`, { text: `t${i}`, savedAt: now + i }]),
  )
  const pruned = pruneReformatStore(entries, 3)
  assert.deepEqual(Object.keys(pruned).sort(), ['card-6', 'card-7', 'card-8'])
})

check('malformed reformat entries are dropped, not thrown on', () => {
  assert.deepEqual(parseReformatStore('nope'), {})
  assert.deepEqual(parseReformatStore('[]'), {})
  assert.deepEqual(parseReformatStore('{"a":{"text":""},"b":5,"c":{"text":"ok"}}'), { c: { text: 'ok', savedAt: 0 } })
})

// ── quiz settings ────────────────────────────────────────────────────

check('quiz settings round trip', () => {
  writeQuizSettings({ timerSeconds: 45, generateCount: 8 })
  assert.deepEqual(readQuizSettings(), { timerSeconds: 45, generateCount: 8 })
})

check('out-of-range or junk quiz settings are clamped to something usable', () => {
  assert.deepEqual(normalizeQuizSettings({ timerSeconds: 0, generateCount: 999 }), { timerSeconds: 15, generateCount: 20 })
  assert.deepEqual(normalizeQuizSettings({ timerSeconds: Number.NaN, generateCount: -4 }), { timerSeconds: 60, generateCount: 1 })
  assert.deepEqual(parseQuizSettings('nope'), DEFAULT_QUIZ_SETTINGS)
  assert.deepEqual(parseQuizSettings('{"timerSeconds":"90"}'), { timerSeconds: 90, generateCount: 5 })
})

console.log(`\nCard panes and stored preferences: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
