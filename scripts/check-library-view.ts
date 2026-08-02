// Locks the library's view logic: ordering (four keys, both directions, pinned
// cards on top), the composing filter bar, and date grouping at each
// granularity. Pure functions from lib/recall-types — no DB, no server.
import assert from 'node:assert/strict'
import {
  cardSources,
  dateFieldFor,
  filterCards,
  groupByDate,
  sortCards,
  tagSubtreeSlugs,
  type CardListItem,
  type LibraryFilters,
  type TagNode,
} from '../lib/recall-types'

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

const NOW = new Date('2026-08-02T12:00:00')

function card(over: Partial<CardListItem> & { id: string }): CardListItem {
  return {
    title: over.id,
    provider: null,
    url: `https://example.com/${over.id}`,
    summary: null,
    status: 'ready',
    sourceType: 'url',
    thumbnail: null,
    shared: false,
    createdAt: '2026-08-02T09:00:00',
    updatedAt: '2026-08-02T09:00:00',
    tags: [],
    ...over,
  }
}

const ids = (cards: CardListItem[]) => cards.map(c => c.id)

// ── ordering ────────────────────────────────────────────────────────────────

const ordering = [
  card({ id: 'b', title: 'Beta', updatedAt: '2026-08-01T10:00:00', createdAt: '2026-07-01T10:00:00', inboundCount: 5 }),
  card({ id: 'a', title: 'Alpha', updatedAt: '2026-08-02T10:00:00', createdAt: '2026-06-01T10:00:00', inboundCount: 1 }),
  card({ id: 'c', title: 'Gamma', updatedAt: '2026-07-30T10:00:00', createdAt: '2026-07-15T10:00:00', inboundCount: 3 }),
]

check('updated desc is newest first', () => {
  assert.deepEqual(ids(sortCards(ordering, 'updated', 'desc')), ['a', 'b', 'c'])
})

check('updated asc is oldest first', () => {
  assert.deepEqual(ids(sortCards(ordering, 'updated', 'asc')), ['c', 'b', 'a'])
})

check('created orders on createdAt, not updatedAt', () => {
  assert.deepEqual(ids(sortCards(ordering, 'created', 'desc')), ['c', 'b', 'a'])
})

check('inbound desc is most-linked first', () => {
  assert.deepEqual(ids(sortCards(ordering, 'inbound', 'desc')), ['b', 'c', 'a'])
})

check('inbound asc is fewest-linked first', () => {
  assert.deepEqual(ids(sortCards(ordering, 'inbound', 'asc')), ['a', 'c', 'b'])
})

check('cards without an inbound count sort as zero', () => {
  const mixed = [card({ id: 'none' }), card({ id: 'two', inboundCount: 2 })]
  assert.deepEqual(ids(sortCards(mixed, 'inbound', 'desc')), ['two', 'none'])
})

check('alphabetical ascending is A to Z', () => {
  assert.deepEqual(ids(sortCards(ordering, 'alpha', 'asc')), ['a', 'b', 'c'])
})

check('alphabetical descending is Z to A', () => {
  assert.deepEqual(ids(sortCards(ordering, 'alpha', 'desc')), ['c', 'b', 'a'])
})

check('pinned cards float to the top in both directions', () => {
  const withPin = [
    card({ id: 'new', updatedAt: '2026-08-02T11:00:00' }),
    card({ id: 'pin', updatedAt: '2026-01-01T11:00:00', triageStatus: 'pinned' }),
  ]
  assert.equal(sortCards(withPin, 'updated', 'desc')[0].id, 'pin')
  assert.equal(sortCards(withPin, 'updated', 'asc')[0].id, 'pin')
})

check('sortCards does not mutate its input', () => {
  const input = [...ordering]
  sortCards(input, 'alpha', 'asc')
  assert.deepEqual(ids(input), ['b', 'a', 'c'])
})

check('dateFieldFor only switches to createdAt for the created order', () => {
  assert.equal(dateFieldFor('created'), 'createdAt')
  for (const order of ['updated', 'inbound', 'alpha'] as const) {
    assert.equal(dateFieldFor(order), 'updatedAt')
  }
})

// ── filters ─────────────────────────────────────────────────────────────────

const NONE: LibraryFilters = { date: 'all', source: null, shared: 'all', tags: [] }

const library = [
  card({ id: 'today', updatedAt: '2026-08-02T08:00:00', provider: 'nytimes.com', shared: true, tags: [{ name: 'AI', slug: 'ai', color: '#fff' }] }),
  card({ id: 'week', updatedAt: '2026-07-29T08:00:00', provider: 'youtube' }),
  card({ id: 'month', updatedAt: '2026-07-12T08:00:00', provider: 'nytimes.com', tags: [{ name: 'Agents', slug: 'agents', color: '#fff' }] }),
  card({ id: 'old', updatedAt: '2026-05-01T08:00:00', provider: null }),
]

check('no filters keeps every card', () => {
  assert.deepEqual(ids(filterCards(library, NONE, 'updated', NOW)), ['today', 'week', 'month', 'old'])
})

check('date windows narrow correctly', () => {
  assert.deepEqual(ids(filterCards(library, { ...NONE, date: 'today' }, 'updated', NOW)), ['today'])
  assert.deepEqual(ids(filterCards(library, { ...NONE, date: 'week' }, 'updated', NOW)), ['today', 'week'])
  assert.deepEqual(ids(filterCards(library, { ...NONE, date: 'month' }, 'updated', NOW)), ['today', 'week', 'month'])
})

check('the date filter follows the active order field', () => {
  const cards = [card({ id: 'x', createdAt: '2026-08-02T08:00:00', updatedAt: '2026-01-01T08:00:00' })]
  assert.deepEqual(ids(filterCards(cards, { ...NONE, date: 'today' }, 'created', NOW)), ['x'])
  assert.deepEqual(ids(filterCards(cards, { ...NONE, date: 'today' }, 'updated', NOW)), [])
})

check('source filters on the exact provider', () => {
  assert.deepEqual(ids(filterCards(library, { ...NONE, source: 'nytimes.com' }, 'updated', NOW)), ['today', 'month'])
})

check('shared filter splits shared from private', () => {
  assert.deepEqual(ids(filterCards(library, { ...NONE, shared: 'shared' }, 'updated', NOW)), ['today'])
  assert.deepEqual(ids(filterCards(library, { ...NONE, shared: 'private' }, 'updated', NOW)), ['week', 'month', 'old'])
})

check('tag filter matches any selected tag', () => {
  assert.deepEqual(ids(filterCards(library, { ...NONE, tags: ['ai', 'agents'] }, 'updated', NOW)), ['today', 'month'])
})

check('filters compose', () => {
  const both: LibraryFilters = { date: 'month', source: 'nytimes.com', shared: 'private', tags: [] }
  assert.deepEqual(ids(filterCards(library, both, 'updated', NOW)), ['month'])
})

check('an impossible combination returns nothing rather than everything', () => {
  const impossible: LibraryFilters = { date: 'today', source: 'youtube', shared: 'shared', tags: [] }
  assert.deepEqual(ids(filterCards(library, impossible, 'updated', NOW)), [])
})

check('cardSources lists distinct providers, sorted, without blanks', () => {
  assert.deepEqual(cardSources(library), ['nytimes.com', 'youtube'])
})

// ── tag subtree expansion ───────────────────────────────────────────────────

const tree: TagNode[] = [
  {
    id: '1', name: 'Tech', slug: 'tech', color: '#fff', parentId: null, count: 3,
    children: [
      { id: '2', name: 'AI', slug: 'ai', color: '#fff', parentId: '1', count: 2, children: [
        { id: '3', name: 'Agents', slug: 'agents', color: '#fff', parentId: '2', count: 1, children: [] },
      ] },
    ],
  },
  { id: '4', name: 'Cooking', slug: 'cooking', color: '#fff', parentId: null, count: 1, children: [] },
]

check('selecting a parent tag pulls in its whole subtree', () => {
  assert.deepEqual(tagSubtreeSlugs(tree, ['tech']).sort(), ['agents', 'ai', 'tech'])
})

check('selecting a leaf tag stays a leaf', () => {
  assert.deepEqual(tagSubtreeSlugs(tree, ['agents']), ['agents'])
})

check('an unrelated branch is not pulled in', () => {
  assert.ok(!tagSubtreeSlugs(tree, ['tech']).includes('cooking'))
})

check('no selection expands to nothing', () => {
  assert.deepEqual(tagSubtreeSlugs(tree, []), [])
})

// ── grouping ────────────────────────────────────────────────────────────────

const grouped = [
  card({ id: 'today', updatedAt: '2026-08-02T09:00:00' }),
  card({ id: 'yesterday', updatedAt: '2026-08-01T09:00:00' }),
  card({ id: 'lastweek', updatedAt: '2026-07-24T09:00:00' }),
  card({ id: 'lastmonth', updatedAt: '2026-06-10T09:00:00' }),
]

check('day grouping keeps the original Today / Yesterday labels', () => {
  const groups = groupByDate(grouped, 'updatedAt', 'day', NOW)
  assert.equal(groups[0].label, 'Today')
  assert.deepEqual(ids(groups[0].cards), ['today'])
  assert.equal(groups[1].label, 'Yesterday')
})

check('day grouping is the default granularity', () => {
  assert.deepEqual(
    groupByDate(grouped, 'updatedAt', undefined, NOW).map(g => g.label),
    groupByDate(grouped, 'updatedAt', 'day', NOW).map(g => g.label),
  )
})

// NOW is Sunday 2026-08-02 and weeks are Sunday-anchored, so "this week" starts
// that morning: Saturday 2026-08-01 belongs to the previous week.
check('week grouping is Sunday-anchored', () => {
  const groups = groupByDate(grouped, 'updatedAt', 'week', NOW)
  assert.deepEqual(groups[0], { label: 'This week', cards: [grouped[0]] })
  assert.deepEqual(ids(groups[1].cards), ['yesterday'])
  assert.equal(groups[1].label, 'Last week')
  assert.deepEqual(ids(groups[2].cards), ['lastweek'])
  assert.ok(groups[2].label.startsWith('Week of'), `expected a dated week label, got ${groups[2].label}`)
})

check('week grouping collapses separate days of the same week', () => {
  const midweek = new Date('2026-08-05T12:00:00') // Wednesday
  const cards = [
    card({ id: 'wed', updatedAt: '2026-08-05T09:00:00' }),
    card({ id: 'mon', updatedAt: '2026-08-03T09:00:00' }),
  ]
  const groups = groupByDate(cards, 'updatedAt', 'week', midweek)
  assert.equal(groups.length, 1)
  assert.deepEqual(ids(groups[0].cards), ['wed', 'mon'])
})

check('month grouping buckets by calendar month', () => {
  const groups = groupByDate(grouped, 'updatedAt', 'month', NOW)
  assert.equal(groups[0].label, 'This month')
  assert.deepEqual(ids(groups[0].cards), ['today', 'yesterday'])
  assert.deepEqual(groups.slice(1).map(g => ids(g.cards)), [['lastweek'], ['lastmonth']])
  assert.equal(groups.length, 3)
})

check('none returns a single unlabelled bucket holding every card', () => {
  const groups = groupByDate(grouped, 'updatedAt', 'none', NOW)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, '')
  assert.equal(groups[0].cards.length, grouped.length)
})

check('grouping an empty list produces no buckets at any granularity', () => {
  for (const granularity of ['day', 'week', 'month', 'none'] as const) {
    assert.deepEqual(groupByDate([], 'updatedAt', granularity, NOW), [])
  }
})

check('every card survives grouping at every granularity', () => {
  for (const granularity of ['day', 'week', 'month', 'none'] as const) {
    const total = groupByDate(grouped, 'updatedAt', granularity, NOW).reduce((sum, g) => sum + g.cards.length, 0)
    assert.equal(total, grouped.length, `${granularity} dropped cards`)
  }
})

console.log(`\nLibrary view: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
