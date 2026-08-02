// Guards lib/knowledge-graph.ts: the whole-library graph must dedupe entities
// into hubs, dedupe links, never invent an edge to a node it dropped, and be
// honest about what it cut. Pure check, no DB, no server, no AI.
import assert from 'node:assert/strict'
import {
  buildKnowledgeGraph,
  type KnowledgeGraphCardRow,
  type KnowledgeGraphConnectionRow,
} from '../lib/knowledge-graph'

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

const card = (id: string, title: string | null = id, text = ''): KnowledgeGraphCardRow => ({ id, title, text })
const link = (fromId: string, toId: string): KnowledgeGraphConnectionRow => ({ fromId, toId, entityType: 'Card', label: 'relates to' })
const entity = (fromId: string, entityType: string, label: string): KnowledgeGraphConnectionRow => ({ fromId, toId: null, entityType, label })

check('every card becomes a node, including cards with no connections', () => {
  const graph = buildKnowledgeGraph([card('a'), card('b'), card('c')], [])
  assert.equal(graph.nodes.length, 3)
  assert.equal(graph.totalNodes, 3)
  assert.equal(graph.edges.length, 0)
  assert.equal(graph.truncated, false)
  assert.ok(graph.nodes.every(node => node.kind === 'card' && node.cardId === node.id))
})

check('an entity named on two cards is ONE hub node, not two leaves', () => {
  const graph = buildKnowledgeGraph(
    [card('a'), card('b')],
    [entity('a', 'Software', 'Prisma'), entity('b', 'Software', 'prisma')]
  )
  const entities = graph.nodes.filter(node => node.kind === 'entity')
  assert.equal(entities.length, 1, 'case-different labels must collapse')
  assert.equal(entities[0].degree, 2)
  assert.equal(entities[0].label, 'Prisma', 'the first-seen casing is kept for display')
  assert.equal(entities[0].cardId, null, 'entities have no card page to open')
  assert.equal(graph.edges.length, 2)
})

check('the same label under a different entity type stays separate', () => {
  const graph = buildKnowledgeGraph(
    [card('a')],
    [entity('a', 'Software', 'Mercury'), entity('a', 'Corporation', 'Mercury')]
  )
  assert.equal(graph.nodes.filter(node => node.kind === 'entity').length, 2)
})

check('duplicate links between the same pair collapse, in either direction', () => {
  const graph = buildKnowledgeGraph(
    [card('a'), card('b')],
    [link('a', 'b'), link('a', 'b'), link('b', 'a')]
  )
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.totalEdges, 1)
  assert.deepEqual(graph.nodes.map(node => node.degree), [1, 1])
})

check('the same entity extracted twice off one card is one link', () => {
  const graph = buildKnowledgeGraph([card('a')], [entity('a', 'Book', 'Dune'), entity('a', 'Book', 'Dune')])
  assert.equal(graph.edges.length, 1)
})

check('self-links and links to unknown cards are dropped, never rendered', () => {
  const graph = buildKnowledgeGraph(
    [card('a'), card('b')],
    [link('a', 'a'), link('a', 'ghost'), link('ghost', 'b'), link('a', 'b')]
  )
  assert.equal(graph.edges.length, 1)
  assert.deepEqual(graph.edges[0], { source: 'a', target: 'b' })
})

check('a blank entity label produces no node', () => {
  const graph = buildKnowledgeGraph([card('a')], [entity('a', 'Software', '   ')])
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.edges.length, 0)
})

check('degree counts every touching edge', () => {
  const graph = buildKnowledgeGraph(
    [card('hub'), card('b'), card('c')],
    [link('hub', 'b'), link('hub', 'c'), entity('hub', 'Software', 'Prisma')]
  )
  const byId = new Map(graph.nodes.map(node => [node.id, node.degree]))
  assert.equal(byId.get('hub'), 3)
  assert.equal(byId.get('b'), 1)
  assert.equal(byId.get('c'), 1)
})

check('nodes come back most connected first, so truncation keeps the structure', () => {
  const graph = buildKnowledgeGraph(
    [card('lonely'), card('hub'), card('b')],
    [link('hub', 'b')]
  )
  assert.deepEqual(graph.nodes.map(node => node.id), ['b', 'hub', 'lonely'])
})

check('over the cap: totals stay honest and truncated flips', () => {
  const cards = ['a', 'b', 'c', 'd'].map(id => card(id))
  const graph = buildKnowledgeGraph(cards, [link('a', 'b'), link('b', 'c')], { maxNodes: 2 })
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.totalNodes, 4, 'totalNodes must report the whole library')
  assert.equal(graph.totalEdges, 2, 'totalEdges must report every link, not the kept ones')
  assert.equal(graph.truncated, true)
  assert.deepEqual(graph.nodes.map(node => node.id), ['b', 'a'], 'the most connected survive')
})

check('a truncated graph never keeps an edge pointing at a dropped node', () => {
  const cards = ['a', 'b', 'c', 'd', 'e'].map(id => card(id))
  const graph = buildKnowledgeGraph(
    cards,
    [link('a', 'b'), link('a', 'c'), link('d', 'e')],
    { maxNodes: 3 }
  )
  const kept = new Set(graph.nodes.map(node => node.id))
  for (const edge of graph.edges) {
    assert.ok(kept.has(edge.source), `edge source ${edge.source} was dropped from nodes`)
    assert.ok(kept.has(edge.target), `edge target ${edge.target} was dropped from nodes`)
  }
})

check('a card with no title falls back to its text, then to Untitled', () => {
  const graph = buildKnowledgeGraph(
    [card('a', null, '  a long excerpt about something  '), card('b', '   ', '')],
    []
  )
  const byId = new Map(graph.nodes.map(node => [node.id, node.label]))
  assert.equal(byId.get('a'), 'a long excerpt about something')
  assert.equal(byId.get('b'), 'Untitled')
})

check('same input, same output: the layout must not reshuffle between requests', () => {
  const cards = ['a', 'b', 'c'].map(id => card(id))
  const connections = [link('a', 'b'), entity('a', 'Software', 'Prisma'), entity('c', 'Software', 'Prisma')]
  assert.deepEqual(
    buildKnowledgeGraph(cards, connections),
    buildKnowledgeGraph(cards, connections)
  )
})

console.log(`\nKnowledge graph: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
