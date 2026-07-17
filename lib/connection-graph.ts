import { getPrisma } from './db'
import type { CardGraph, CardGraphCard, CardGraphEdge, CardGraphEntity } from './recall-types'

const MAX_DEPTH = 3
const MAX_CARDS = 40
const MAX_ENTITIES = 80
const MAX_EDGES = 140

const CARD_SELECT = {
  id: true,
  title: true,
  text: true,
  provider: true,
  postUrl: true,
} as const

type GraphConnectionRow = {
  id: string
  fromId: string
  toId: string | null
  entityType: string
  label: string
  origin: string
  from: CardRow
  to: CardRow | null
}

type CardRow = {
  id: string
  title: string | null
  text: string
  provider: string | null
  postUrl: string
}

export class CardGraphError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function getCardGraph(rootId: string, requestedDepth: number): Promise<CardGraph> {
  const depth = normalizeDepth(requestedDepth)
  const prisma = getPrisma()
  const root = await prisma.bookmark.findUnique({
    where: { id: rootId },
    select: CARD_SELECT,
  })
  if (!root) throw new CardGraphError('Card not found', 404)

  const cards = new Map<string, CardGraphCard>()
  const visitedDepth = new Map<string, number>([[root.id, 0]])
  cards.set(root.id, toGraphCard(root, 0))

  const edges = new Map<string, CardGraphEdge>()
  const entities = new Map<string, CardGraphEntity>()
  let frontier = [root.id]

  for (let currentDepth = 0; currentDepth < depth && frontier.length > 0; currentDepth++) {
    const rows = await prisma.connection.findMany({
      where: {
        OR: [
          { fromId: { in: frontier } },
          { toId: { in: frontier } },
        ],
      },
      include: {
        from: { select: CARD_SELECT },
        to: { select: CARD_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_EDGES,
    }) as GraphConnectionRow[]

    const nextFrontier: string[] = []
    for (const row of rows) {
      if (edges.size >= MAX_EDGES) break

      if (row.to) {
        const fromDepth = visitedDepth.get(row.fromId)
        const toDepth = visitedDepth.get(row.to.id)
        const rowDepth = Math.min(
          fromDepth === undefined ? Number.POSITIVE_INFINITY : fromDepth,
          toDepth === undefined ? Number.POSITIVE_INFINITY : toDepth,
        ) + 1

        addCard(row.from, fromDepth ?? rowDepth)
        addCard(row.to, toDepth ?? rowDepth)
        addEdge(row, rowDepth)

        const neighbor = frontier.includes(row.fromId) ? row.to : row.from
        if (!visitedDepth.has(neighbor.id) && rowDepth <= depth && cards.size < MAX_CARDS) {
          visitedDepth.set(neighbor.id, rowDepth)
          cards.set(neighbor.id, toGraphCard(neighbor, rowDepth))
          nextFrontier.push(neighbor.id)
        }
      } else if (frontier.includes(row.fromId) && currentDepth + 1 <= depth && entities.size < MAX_ENTITIES) {
        addEntity(row, currentDepth + 1)
      }
    }

    frontier = [...new Set(nextFrontier)]
  }

  return {
    rootId,
    depth,
    cards: [...cards.values()].sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title)),
    entities: [...entities.values()].sort((a, b) => a.depth - b.depth || a.entityType.localeCompare(b.entityType) || a.label.localeCompare(b.label)),
    edges: [...edges.values()].sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label)),
  }

  function addCard(card: CardRow, fallbackDepth: number) {
    if (cards.has(card.id) || cards.size >= MAX_CARDS) return
    const cardDepth = Math.min(depth, visitedDepth.get(card.id) ?? fallbackDepth)
    cards.set(card.id, toGraphCard(card, cardDepth))
  }

  function addEdge(row: GraphConnectionRow, rowDepth: number) {
    if (edges.has(row.id)) return
    edges.set(row.id, {
      id: row.id,
      fromId: row.fromId,
      toId: row.toId ?? '',
      label: row.label,
      entityType: row.entityType,
      origin: row.origin,
      depth: Math.min(depth, rowDepth),
    })
  }

  function addEntity(row: GraphConnectionRow, entityDepth: number) {
    if (entities.has(row.id)) return
    entities.set(row.id, {
      id: row.id,
      label: row.label,
      entityType: row.entityType,
      origin: row.origin,
      fromCardId: row.fromId,
      depth: entityDepth,
    })
  }
}

function normalizeDepth(value: number): number {
  return Math.max(1, Math.min(MAX_DEPTH, Number.isFinite(value) ? Math.round(value) : 1))
}

function toGraphCard(card: CardRow, depth: number): CardGraphCard {
  return {
    id: card.id,
    title: card.title || card.text.slice(0, 120) || 'Untitled',
    provider: card.provider,
    url: card.postUrl,
    depth,
  }
}
