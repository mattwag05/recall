// Guards lib/force-layout.ts: the graph layout must be deterministic (a
// re-render must not reshuffle nodes), in bounds, and non-degenerate.
import assert from 'node:assert/strict'
import { forceLayout, type LayoutEdge, type LayoutNode } from '../lib/force-layout'

function inBounds(positions: Map<string, { x: number; y: number }>, label: string) {
  for (const [id, p] of positions) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: ${id} has a non-finite position`)
    assert.ok(p.x >= 0 && p.x <= 100, `${label}: ${id} x=${p.x} out of 0..100`)
    assert.ok(p.y >= 0 && p.y <= 100, `${label}: ${id} y=${p.y} out of 0..100`)
  }
}

// Empty and single-node graphs.
assert.equal(forceLayout([], []).size, 0, 'empty graph should produce no positions')
const single = forceLayout([{ id: 'a' }], [])
assert.deepEqual(single.get('a'), { x: 50, y: 50 }, 'a lone node should sit dead centre')

// A hub with ten spokes: the shape we actually render on a card.
const hub: LayoutNode[] = [{ id: 'root', weight: 3, fixed: { x: 50, y: 50 } }]
const spokes: LayoutEdge[] = []
for (let i = 0; i < 10; i++) {
  hub.push({ id: `n${i}` })
  spokes.push({ source: 'root', target: `n${i}` })
}

const first = forceLayout(hub, spokes)
const second = forceLayout(hub, spokes)
assert.equal(first.size, 11, 'every node should get a position')
inBounds(first, 'hub')

// Determinism is the whole reason this is hand-rolled rather than a simulation.
for (const [id, p] of first) {
  const q = second.get(id)!
  assert.equal(p.x, q.x, `x drifted between identical runs for ${id}`)
  assert.equal(p.y, q.y, `y drifted between identical runs for ${id}`)
}

// A pinned node must actually stay pinned.
const root = first.get('root')!
assert.ok(
  Math.abs(root.x - 50) < 25 && Math.abs(root.y - 50) < 25,
  `pinned root drifted to ${root.x},${root.y}`
)

// Nodes must not pile up on one another — the failure mode that makes a graph
// unreadable, and the one a bounds check alone would not catch.
const points = [...first.values()]
let closest = Infinity
for (let i = 0; i < points.length; i++) {
  for (let j = i + 1; j < points.length; j++) {
    closest = Math.min(closest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y))
  }
}
assert.ok(closest > 1, `nodes overlap: closest pair is ${closest.toFixed(2)} apart`)

// Disconnected nodes (entities with no edges yet) must still land on screen.
const islands = forceLayout(
  [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  [{ source: 'a', target: 'b' }]
)
assert.equal(islands.size, 4, 'disconnected nodes should still be placed')
inBounds(islands, 'islands')

// Edges naming unknown nodes are dropped, not turned into NaN.
const dangling = forceLayout([{ id: 'a' }, { id: 'b' }], [{ source: 'a', target: 'ghost' }])
inBounds(dangling, 'dangling')

// The layout must actually spread the graph out, not just avoid collisions:
// a settled hub should fill most of the padded box on both axes.
const width = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x))
const height = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))
assert.ok(width > 50 && height > 50, `layout collapsed: spans ${width.toFixed(1)}x${height.toFixed(1)}`)

console.log('force-layout checks passed')
