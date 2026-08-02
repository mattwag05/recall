'use client'

// Full-viewport force-directed view of the whole library.
//
// The expensive part is the layout, not the render: forceLayout is O(n^2) per
// iteration, so at the 800-node cap a full 300-iteration settle costs ~1.5s of
// blocked main thread. Two things keep that off the user's face:
//   1. iterations scale down with node count (measured: quality is flat past
//      ~60 iterations at this density, cost is linear in iterations),
//   2. the layout runs in ONE useMemo keyed on the payload, so nothing except a
//      refetch can re-run it. Search and the settings toggles change opacity
//      only, never the node set, so positions never move under the cursor.
// ponytail: no web worker. The layout runs once per page load behind the
// existing loading state. Move it to a worker if the cap ever goes past ~1200.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Maximize2, Minimize2, Search, Settings } from 'lucide-react'
import { forceLayout, type LayoutNode } from '@/lib/force-layout'
import type { KnowledgeGraph, KnowledgeGraphNode } from '@/lib/knowledge-graph'

/** Nodes are returned degree-sorted, so the first N are the most connected. */
const LABELLED_NODES = 40

type Filters = {
  cards: boolean
  entities: boolean
  links: boolean
  labels: boolean
}

export function KnowledgeGraphView() {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [filters, setFilters] = useState<Filters>({ cards: true, entities: true, links: true, labels: true })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/graph')
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(errorMessage(data))
        if (!isGraphResponse(data)) throw new Error('The graph API returned an unexpected response')
        if (!cancelled) setGraph(data.graph)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the knowledge graph')
          setGraph(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [reloadKey])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    void containerRef.current?.requestFullscreen().catch(() => {})
  }, [])

  // The one expensive call. Keyed on the payload, so a keystroke in the search
  // box or a filter toggle cannot re-run it.
  const layout = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null
    const nodes: LayoutNode[] = graph.nodes.map(node => ({
      id: node.id,
      // Well connected nodes get pulled harder toward the centre, which is what
      // makes hubs read as hubs instead of drifting to the rim.
      weight: 1 + Math.min(node.degree, 24) / 8,
    }))
    const iterations = graph.nodes.length > 600 ? 90 : graph.nodes.length > 300 ? 150 : 300
    const started = performance.now()
    const positions = forceLayout(nodes, graph.edges, { iterations, padding: 5 })
    return { positions, ms: Math.round(performance.now() - started) }
  }, [graph])

  const normalizedQuery = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!graph || !normalizedQuery) return null
    return new Set(
      graph.nodes.filter(node => node.label.toLowerCase().includes(normalizedQuery)).map(node => node.id)
    )
  }, [graph, normalizedQuery])

  const visible = useMemo(() => {
    if (!graph) return new Set<string>()
    return new Set(
      graph.nodes
        .filter(node => (node.kind === 'card' ? filters.cards : filters.entities))
        .map(node => node.id)
    )
  }, [graph, filters.cards, filters.entities])

  const visibleEdges = useMemo(() => {
    if (!graph || !filters.links) return []
    return graph.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target))
  }, [graph, filters.links, visible])

  const shownNodes = graph ? graph.nodes.filter(node => visible.has(node.id)) : []

  // Dots have to shrink as the graph grows or 800 nodes read as one purple blob.
  const sizeScale = shownNodes.length > 500 ? 0.5 : shownNodes.length > 250 ? 0.7 : 1

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{ height: '100dvh', background: 'var(--paper)' }}
    >
      {layout && graph && (
        <GraphCanvas
          graph={graph}
          nodes={shownNodes}
          edges={visibleEdges}
          positions={layout.positions}
          matches={matches}
          hovered={hovered}
          showLabels={filters.labels}
          sizeScale={sizeScale}
          onHover={setHovered}
        />
      )}

      {/* z-10 keeps the chrome above the nodes, which sit at z-index 2 and 3. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-6">
        <div className="pointer-events-auto">
          <Link href="/items" className="rr-btn rr-btn-icon" aria-label="Back to library">
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Library</span>
          </Link>
          <h1 className="font-display mt-3" style={{ fontSize: '1.5rem', fontWeight: 500 }}>Knowledge graph</h1>
          <p className="rr-mono" style={{ color: 'var(--accent)' }}>every card and entity in one view</p>
        </div>

        <div className="pointer-events-auto relative flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="relative">
              <span className="sr-only">Search by title</span>
              <Search
                size={14}
                aria-hidden="true"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--sepia)' }}
              />
              <input
                className="rr-input"
                style={{ paddingLeft: 30, minWidth: 210 }}
                type="search"
                placeholder="Search by title"
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              className="rr-btn rr-btn-icon"
              aria-expanded={settingsOpen}
              aria-controls="knowledge-graph-settings"
              aria-label={settingsOpen ? 'Close graph settings' : 'Open graph settings'}
              onClick={() => setSettingsOpen(open => !open)}
            >
              <Settings size={14} aria-hidden="true" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              className="rr-btn rr-btn-icon"
              aria-pressed={fullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
              <span>{fullscreen ? 'Exit' : 'Fullscreen'}</span>
            </button>
          </div>

          {matches && (
            <p className="rr-mono" aria-live="polite" style={{ color: matches.size ? 'var(--accent)' : 'var(--sepia)' }}>
              {matches.size} {matches.size === 1 ? 'match' : 'matches'}
            </p>
          )}

          {settingsOpen && (
            // Floated out of flow so opening it cannot reflow the toolbar above it.
            <section
              id="knowledge-graph-settings"
              className="rr-card absolute right-0 top-full mt-2 p-4"
              aria-label="Graph settings"
              style={{ width: 230 }}
            >
              <p className="rr-mono mb-2" style={{ color: 'var(--accent)' }}>Show</p>
              <div className="space-y-1.5">
                <GraphToggle label="Cards" checked={filters.cards} onChange={value => setFilters(f => ({ ...f, cards: value }))} />
                <GraphToggle label="Entities" checked={filters.entities} onChange={value => setFilters(f => ({ ...f, entities: value }))} />
                <GraphToggle label="Links" checked={filters.links} onChange={value => setFilters(f => ({ ...f, links: value }))} />
                <GraphToggle label="Labels" checked={filters.labels} onChange={value => setFilters(f => ({ ...f, labels: value }))} />
              </div>
              <p className="rr-prose mt-3" style={{ fontSize: '0.82rem' }}>
                Filters change what is drawn, never where nodes sit, so the layout stays put.
              </p>
            </section>
          )}
        </div>
      </header>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4 sm:p-6">
        <div className="pointer-events-auto inline-block max-w-full">
          {loading && <p className="rr-mono">building graph…</p>}

          {error && (
            <div className="rr-card p-4">
              <p className="rr-prose" style={{ fontSize: '0.94rem' }}>{error}</p>
              <button type="button" className="rr-btn mt-3" onClick={() => setReloadKey(key => key + 1)} disabled={loading}>
                {loading ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}

          {graph && !error && (
            <div className="rr-mono" aria-live="polite" style={{ color: 'var(--sepia)' }}>
              <span style={{ color: 'var(--ink)' }}>
                {shownNodes.length.toLocaleString()} nodes · {visibleEdges.length.toLocaleString()} links
              </span>
              {graph.truncated && (
                <span>
                  {' '}· showing the {graph.nodes.length.toLocaleString()} most connected of{' '}
                  {graph.totalNodes.toLocaleString()} nodes and {graph.totalEdges.toLocaleString()} links
                </span>
              )}
              {layout && <span> · laid out in {layout.ms}ms</span>}
            </div>
          )}

          {graph && !error && graph.nodes.length === 0 && (
            <p className="rr-prose mt-2" style={{ fontSize: '0.94rem' }}>
              Nothing to graph yet. Save a card, then generate connections from its Connections tab.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function GraphCanvas({
  graph,
  nodes,
  edges,
  positions,
  matches,
  hovered,
  showLabels,
  sizeScale,
  onHover,
}: {
  graph: KnowledgeGraph
  nodes: KnowledgeGraphNode[]
  edges: { source: string; target: string }[]
  positions: Map<string, { x: number; y: number }>
  matches: Set<string> | null
  hovered: string | null
  showLabels: boolean
  sizeScale: number
  onHover: (id: string | null) => void
}) {
  // A node is "labelled" if it is one of the biggest hubs, a search hit, or
  // under the cursor. Labelling all 800 would be unreadable soup.
  const hubIds = useMemo(
    () => new Set(graph.nodes.slice(0, LABELLED_NODES).map(node => node.id)),
    [graph]
  )

  // forceLayout keeps the settled cloud's own aspect ratio, which leaves a dead
  // band on a wide or tall viewport. Stretch it to fill both axes: the drawing
  // is schematic, so nothing meaningful is lost and the whole canvas gets used.
  // Projected from ALL positions, including hidden nodes, so toggling a filter
  // cannot shift what is left on screen.
  const view = useMemo(() => fillView(positions), [positions])

  return (
    <div
      className="absolute inset-x-4 bottom-14 top-36 sm:inset-x-6 sm:top-40"
      aria-label={`Knowledge graph with ${nodes.length} nodes and ${edges.length} links`}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {edges.map(edge => {
          const from = view.get(edge.source)
          const to = view.get(edge.target)
          if (!from || !to) return null
          const lit = matches
            ? matches.has(edge.source) || matches.has(edge.target)
            : hovered === edge.source || hovered === edge.target
          return (
            <line
              key={`${edge.source}|${edge.target}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={lit ? 'var(--accent)' : 'var(--hairline)'}
              strokeWidth={lit ? 1.1 : 0.7}
              opacity={matches && !lit ? 0.16 : lit ? 0.75 : 0.5}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>

      {nodes.map(node => {
        const position = view.get(node.id)
        if (!position) return null
        const matched = matches ? matches.has(node.id) : false
        const dimmed = Boolean(matches) && !matched
        const active = matched || hovered === node.id
        const size = nodeSize(node.degree, sizeScale)
        const color = node.kind === 'card' ? 'var(--accent)' : 'var(--gold)'
        const label = node.kind === 'entity' && node.entityType
          ? `${node.label} (${node.entityType}, ${node.degree} links)`
          : `${node.label} (${node.degree} links)`
        const showLabel = showLabels && !dimmed && (active || hubIds.has(node.id))

        const dot = (
          <>
            <span
              aria-hidden="true"
              style={{
                display: 'block',
                width: size,
                height: size,
                borderRadius: '50%',
                background: color,
                border: active ? '2px solid var(--ink)' : `1px solid ${node.kind === 'card' ? 'var(--accent-2)' : 'var(--card-edge)'}`,
                boxShadow: active ? '0 0 0 4px color-mix(in srgb, var(--accent) 35%, transparent)' : 'none',
              }}
            />
            {showLabel && (
              <span
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: `calc(50% + ${size / 2 + 4}px)`,
                  transform: 'translateX(-50%)',
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '0.7rem',
                  lineHeight: 1.2,
                  color: active ? 'var(--ink)' : 'var(--ink-soft)',
                  background: 'color-mix(in srgb, var(--card) 82%, transparent)',
                  padding: '1px 4px',
                  borderRadius: 4,
                  pointerEvents: 'none',
                }}
              >
                {node.label}
              </span>
            )}
          </>
        )

        const style: React.CSSProperties = {
          position: 'absolute',
          left: `${position.x}%`,
          top: `${position.y}%`,
          transform: 'translate(-50%, -50%)',
          opacity: dimmed ? 0.18 : 1,
          zIndex: active ? 3 : 2,
          lineHeight: 0,
        }

        return node.cardId ? (
          <Link
            key={node.id}
            href={`/item/${node.cardId}`}
            style={style}
            title={label}
            aria-label={`Open ${label}`}
            onMouseEnter={() => onHover(node.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(node.id)}
            onBlur={() => onHover(null)}
          >
            {dot}
          </Link>
        ) : (
          <button
            key={node.id}
            type="button"
            style={style}
            title={label}
            aria-label={label}
            onMouseEnter={() => onHover(node.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(node.id)}
            onBlur={() => onHover(null)}
            onClick={() => onHover(hovered === node.id ? null : node.id)}
          >
            {dot}
          </button>
        )
      })}
    </div>
  )
}

function GraphToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2" style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.currentTarget.checked)}
        className="accent-[var(--accent)]"
      />
      <span>{label}</span>
    </label>
  )
}

/** Area grows with degree, so a 40-link hub reads as a hub without swamping the view. */
function nodeSize(degree: number, scale: number): number {
  return Math.max(4, Math.round(Math.min(30, 7 + Math.sqrt(degree) * 3.4) * scale))
}

/** Rescale settled positions to fill the canvas on both axes independently. */
// Node labels are centred on their dot and sit outside it, so a node projected
// to exactly 0 or 100 has half its label hanging off the canvas. Stretching to
// a full 0..100 box also throws away the padding forceLayout was asked for.
// Project into an inset box instead, and inset more on the x axis because
// labels are far wider than they are tall.
const VIEW_INSET_X = 9
const VIEW_INSET_Y = 5

function fillView(positions: Map<string, { x: number; y: number }>) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const point of positions.values()) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  const rangeX = 100 - VIEW_INSET_X * 2
  const rangeY = 100 - VIEW_INSET_Y * 2
  const projected = new Map<string, { x: number; y: number }>()
  for (const [id, point] of positions) {
    projected.set(id, {
      x: spanX > 0.01 ? ((point.x - minX) / spanX) * rangeX + VIEW_INSET_X : 50,
      y: spanY > 0.01 ? ((point.y - minY) / spanY) * rangeY + VIEW_INSET_Y : 50,
    })
  }
  return projected
}

function isGraphResponse(data: unknown): data is { graph: KnowledgeGraph } {
  if (data === null || typeof data !== 'object' || !('graph' in data)) return false
  const graph = (data as { graph?: unknown }).graph
  return graph !== null && typeof graph === 'object' &&
    Array.isArray((graph as { nodes?: unknown }).nodes) &&
    Array.isArray((graph as { edges?: unknown }).edges) &&
    typeof (graph as { totalNodes?: unknown }).totalNodes === 'number' &&
    typeof (graph as { totalEdges?: unknown }).totalEdges === 'number'
}

function errorMessage(data: unknown): string {
  if (data !== null && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error
  }
  return 'Could not load the knowledge graph'
}
