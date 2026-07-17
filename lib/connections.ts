import { getPrisma } from './db'

const WIKI_LINK_PATTERN = /\[\[([^\]\n]{1,160})\]\]/g
const MAX_GENERATED_CONNECTIONS = 12
const GENERATED_ENTITY_TYPES = new Set(['Mention', 'Hashtag', 'Website', 'Tool', 'Concept', 'Tag'])

export interface ConnectionInput {
  fromId: string
  targetId?: string | null
  targetTitle?: string | null
  label?: string | null
}

export interface ConnectionResult {
  id: string
  entityType: string
  label: string
  origin: string
  to: {
    id: string
    title: string
    provider: string | null
    url: string
  } | null
  createdAt: Date
}

export interface GeneratedConnectionSummary {
  connections: ConnectionResult[]
  created: number
}

type ConnectionRow = {
  id: string
  entityType: string
  label: string
  origin: string
  createdAt: Date
  to: {
    id: string
    title: string | null
    text: string
    provider: string | null
    postUrl: string
  } | null
}

export async function createManualCardConnection(input: ConnectionInput): Promise<ConnectionResult> {
  const prisma = getPrisma()
  const from = await prisma.bookmark.findUnique({
    where: { id: input.fromId },
    select: { id: true },
  })
  if (!from) throw new ConnectionError('Card not found', 404)

  const target = await findTargetCard(input.fromId, input.targetId, input.targetTitle)
  if (!target) throw new ConnectionError('Target card not found', 404)
  if (target.id === input.fromId) throw new ConnectionError('A card cannot link to itself.', 400)

  const label = normalizeLabel(input.label) ?? cardTitle(target)
  const existing = (await prisma.connection.findFirst({
    where: { fromId: input.fromId, toId: target.id, origin: 'manual', entityType: 'Card' },
    include: CONNECTION_INCLUDE,
  })) as ConnectionRow | null
  if (existing) return toConnectionResult(existing)

  const created = (await prisma.connection.create({
    data: {
      fromId: input.fromId,
      toId: target.id,
      entityType: 'Card',
      label,
      origin: 'manual',
    },
    include: CONNECTION_INCLUDE,
  })) as ConnectionRow
  return toConnectionResult(created)
}

export async function deleteManualConnection(fromId: string, connectionId: string): Promise<boolean> {
  const prisma = getPrisma()
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, fromId },
    select: { id: true, origin: true },
  })
  if (!connection) return false
  if (connection.origin !== 'manual') throw new ConnectionError('Only manual links can be removed here.', 400)
  await prisma.connection.delete({ where: { id: connectionId } })
  return true
}

export async function generateEntityConnections(fromId: string): Promise<GeneratedConnectionSummary> {
  const prisma = getPrisma()
  const card = await prisma.bookmark.findUnique({
    where: { id: fromId },
    select: {
      id: true,
      entities: true,
      semanticTags: true,
      categories: { select: { category: { select: { name: true } } } },
    },
  })
  if (!card) throw new ConnectionError('Card not found', 404)

  const candidates = generatedCandidates(card)
  if (candidates.length === 0) return { connections: [], created: 0 }

  const existing = await prisma.connection.findMany({
    where: {
      fromId,
      origin: 'ai',
      entityType: { in: [...GENERATED_ENTITY_TYPES] },
    },
    select: { id: true, entityType: true, label: true },
  })
  const existingKeys = new Set(existing.map(item => connectionKey(item.entityType, item.label)))

  let created = 0
  for (const candidate of candidates) {
    const key = connectionKey(candidate.entityType, candidate.label)
    if (existingKeys.has(key)) continue
    await prisma.connection.create({
      data: {
        fromId,
        entityType: candidate.entityType,
        label: candidate.label,
        origin: 'ai',
      },
    })
    existingKeys.add(key)
    created++
  }

  const connections = (await prisma.connection.findMany({
    where: {
      fromId,
      origin: 'ai',
      entityType: { in: [...GENERATED_ENTITY_TYPES] },
    },
    include: CONNECTION_INCLUDE,
    orderBy: { createdAt: 'desc' },
  })) as ConnectionRow[]

  return { connections: connections.map(toConnectionResult), created }
}

export async function addNotebookWikiLinks(fromId: string, notebookContent: string): Promise<number> {
  const titles = extractWikiTitles(notebookContent)
  let added = 0
  for (const title of titles) {
    try {
      await createManualCardConnection({ fromId, targetTitle: title, label: title })
      added++
    } catch (err) {
      if (err instanceof ConnectionError && err.status < 500) continue
      throw err
    }
  }
  return added
}

export function serializeConnection(row: ConnectionRow): ConnectionResult {
  return toConnectionResult(row)
}

export class ConnectionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const CONNECTION_INCLUDE = {
  to: { select: { id: true, title: true, text: true, provider: true, postUrl: true } },
} as const

async function findTargetCard(fromId: string, targetId?: string | null, targetTitle?: string | null) {
  const prisma = getPrisma()
  if (targetId) {
    return prisma.bookmark.findUnique({
      where: { id: targetId },
      select: TARGET_SELECT,
    })
  }
  const title = normalizeLabel(targetTitle)
  if (!title) return null
  return prisma.bookmark.findFirst({
    where: {
      id: { not: fromId },
      OR: [
        { title: { equals: title } },
        { title: { contains: title } },
        { text: { contains: title } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: TARGET_SELECT,
  })
}

const TARGET_SELECT = {
  id: true,
  title: true,
  text: true,
  provider: true,
  postUrl: true,
} as const

function extractWikiTitles(markdown: string): string[] {
  const seen = new Set<string>()
  const titles: string[] = []
  for (const match of markdown.matchAll(WIKI_LINK_PATTERN)) {
    const title = normalizeLabel(match[1])
    if (!title) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(title)
  }
  return titles
}

function normalizeLabel(value: string | null | undefined): string | null {
  const label = value?.replace(/\s+/g, ' ').trim()
  return label || null
}

function toConnectionResult(row: ConnectionRow): ConnectionResult {
  return {
    id: row.id,
    entityType: row.entityType,
    label: row.label,
    origin: row.origin,
    to: row.to
      ? {
          id: row.to.id,
          title: cardTitle(row.to),
          provider: row.to.provider,
          url: row.to.postUrl,
        }
      : null,
    createdAt: row.createdAt,
  }
}

function cardTitle(card: { title: string | null; text: string }): string {
  return card.title || card.text.slice(0, 120) || 'Untitled'
}

function generatedCandidates(card: {
  entities: string | null
  semanticTags: string | null
  categories: { category: { name: string } }[]
}): Array<{ entityType: string; label: string }> {
  const candidates: Array<{ entityType: string; label: string }> = []
  const entities = parseObject(card.entities)
  const pushMany = (entityType: string, values: string[]) => {
    for (const value of values) {
      const label = cleanEntityLabel(value)
      if (label) candidates.push({ entityType, label })
    }
  }

  if (entities) {
    pushMany('Mention', stringArrayField(entities.mentions).map(value => `@${value.replace(/^@/, '')}`))
    pushMany('Hashtag', stringArrayField(entities.hashtags).map(value => `#${value.replace(/^#/, '')}`))
    pushMany('Website', stringArrayField(entities.urls).map(urlHostLabel))
    pushMany('Tool', stringArrayField(entities.toolNames))
  }
  pushMany('Concept', parseStringArray(card.semanticTags).slice(0, 10))
  pushMany('Tag', card.categories.map(item => item.category.name).slice(0, 6))

  const seen = new Set<string>()
  const deduped: Array<{ entityType: string; label: string }> = []
  for (const candidate of candidates) {
    const key = connectionKey(candidate.entityType, candidate.label)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(candidate)
    if (deduped.length >= MAX_GENERATED_CONNECTIONS) break
  }
  return deduped
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function urlHostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function cleanEntityLabel(value: string): string | null {
  const label = value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return label.length >= 2 ? label : null
}

function connectionKey(entityType: string, label: string): string {
  return `${entityType.toLowerCase()}:${label.toLowerCase()}`
}
