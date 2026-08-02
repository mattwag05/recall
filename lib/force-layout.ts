// Deterministic force-directed graph layout (Fruchterman-Reingold).
//
// ponytail: hand-rolled instead of d3-force. d3-force pulls in 4 packages and a
// live simulation loop; we only ever need a final frame, computed once, and we
// need it to be the SAME frame every render (a re-render must not reshuffle the
// graph under the user's cursor). Swap in d3-force only if we need drag,
// collision, or continuous animation.
//
// Coordinates come out in a 0..100 percentage box so callers can position nodes
// with `left: x%` / `top: y%` exactly like the old static-circle layout did.

export type LayoutNode = {
  id: string
  /** Relative pull toward the centre. Higher = more central. Defaults to 1. */
  weight?: number
  /** Pin a node in place (0..100 space). The root card uses this. */
  fixed?: { x: number; y: number }
}

export type LayoutEdge = { source: string; target: string }

export type LayoutOptions = {
  /** More iterations = more settled, linearly more expensive. */
  iterations?: number
  /** Fraction of the box to leave clear at the edges, so labels aren't clipped. */
  padding?: number
}

export type LayoutPosition = { x: number; y: number }

const DEFAULT_ITERATIONS = 300
const DEFAULT_PADDING = 8

/**
 * Lay out `nodes` connected by `edges`. Returns a map of node id -> {x, y},
 * both in 0..100. Nodes not referenced by any edge still get a position.
 * Pure and deterministic: same inputs -> same output, with no RNG involved.
 */
export function forceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {}
): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>()
  if (nodes.length === 0) return positions
  if (nodes.length === 1) {
    positions.set(nodes[0].id, nodes[0].fixed ?? { x: 50, y: 50 })
    return positions
  }

  const iterations = Math.max(1, options.iterations ?? DEFAULT_ITERATIONS)
  const padding = clamp(options.padding ?? DEFAULT_PADDING, 0, 40)

  // Work in a square arena, then normalise to 0..100 at the end. `k` is the
  // ideal edge length: the side of the per-node cell in an evenly packed grid.
  const area = 100 * 100
  const k = Math.sqrt(area / nodes.length)

  const index = new Map<string, number>()
  const xs = new Float64Array(nodes.length)
  const ys = new Float64Array(nodes.length)
  const dx = new Float64Array(nodes.length)
  const dy = new Float64Array(nodes.length)

  nodes.forEach((node, i) => {
    index.set(node.id, i)
    if (node.fixed) {
      xs[i] = node.fixed.x
      ys[i] = node.fixed.y
      return
    }
    // Start on a ring rather than at random points: a ring has no coincident
    // points, so the repulsion step can never divide by zero. The radius walks
    // in a co-prime stride so large graphs start on several rings at once,
    // which breaks the symmetry that would otherwise leave a regular graph
    // stuck in its initial arrangement.
    const angle = (i / nodes.length) * Math.PI * 2
    const radius = 20 + ((i * 7) % 25)
    xs[i] = 50 + Math.cos(angle) * radius
    ys[i] = 50 + Math.sin(angle) * radius
  })

  // Drop edges pointing at nodes we weren't given, so a truncated graph payload
  // can't produce NaN positions.
  const links = edges
    .map(edge => ({ a: index.get(edge.source), b: index.get(edge.target) }))
    .filter((l): l is { a: number; b: number } => l.a !== undefined && l.b !== undefined && l.a !== l.b)

  let temperature = 100 / 10

  for (let step = 0; step < iterations; step++) {
    dx.fill(0)
    dy.fill(0)

    // Repulsion: every node pushes every other away. O(n^2), which is fine at
    // our caps (40 cards + 80 entities per card graph).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const deltaX = xs[i] - xs[j]
        const deltaY = ys[i] - ys[j]
        const distance = Math.max(0.01, Math.hypot(deltaX, deltaY))
        const force = (k * k) / distance
        const fx = (deltaX / distance) * force
        const fy = (deltaY / distance) * force
        dx[i] += fx
        dy[i] += fy
        dx[j] -= fx
        dy[j] -= fy
      }
    }

    // Attraction along edges.
    for (const link of links) {
      const deltaX = xs[link.a] - xs[link.b]
      const deltaY = ys[link.a] - ys[link.b]
      const distance = Math.max(0.01, Math.hypot(deltaX, deltaY))
      const force = (distance * distance) / k
      const fx = (deltaX / distance) * force
      const fy = (deltaY / distance) * force
      dx[link.a] -= fx
      dy[link.a] -= fy
      dx[link.b] += fx
      dy[link.b] += fy
    }

    // Gravity toward the centre, scaled by weight. Without it, disconnected
    // nodes drift out of the viewport forever.
    for (let i = 0; i < nodes.length; i++) {
      const weight = nodes[i].weight ?? 1
      dx[i] += (50 - xs[i]) * 0.08 * weight
      dy[i] += (50 - ys[i]) * 0.08 * weight
    }

    // Displace, capped by the cooling temperature.
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].fixed) continue
      const distance = Math.max(0.01, Math.hypot(dx[i], dy[i]))
      const capped = Math.min(distance, temperature)
      xs[i] += (dx[i] / distance) * capped
      ys[i] += (dy[i] / distance) * capped
    }

    temperature *= 0.98
  }

  return normalise(nodes, xs, ys, padding)
}

/** Rescale the settled cloud to fill the padded 0..100 box. */
function normalise(
  nodes: LayoutNode[],
  xs: Float64Array,
  ys: Float64Array,
  padding: number
): Map<string, LayoutPosition> {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < nodes.length; i++) {
    if (xs[i] < minX) minX = xs[i]
    if (xs[i] > maxX) maxX = xs[i]
    if (ys[i] < minY) minY = ys[i]
    if (ys[i] > maxY) maxY = ys[i]
  }

  const span = 100 - padding * 2
  // A degenerate axis (every node on one line) would divide by zero; centre instead.
  const spreadX = maxX - minX
  const spreadY = maxY - minY
  const scale = Math.min(
    spreadX > 0.01 ? span / spreadX : Infinity,
    spreadY > 0.01 ? span / spreadY : Infinity
  )
  const factor = Number.isFinite(scale) ? scale : 1
  const offsetX = spreadX > 0.01 ? padding : 50 - ((minX + maxX) / 2) * factor
  const offsetY = spreadY > 0.01 ? padding : 50 - ((minY + maxY) / 2) * factor

  const positions = new Map<string, LayoutPosition>()
  for (let i = 0; i < nodes.length; i++) {
    positions.set(nodes[i].id, {
      x: clamp(spreadX > 0.01 ? (xs[i] - minX) * factor + offsetX : xs[i] * factor + offsetX, 0, 100),
      y: clamp(spreadY > 0.01 ? (ys[i] - minY) * factor + offsetY : ys[i] * factor + offsetY, 0, 100),
    })
  }
  return positions
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
