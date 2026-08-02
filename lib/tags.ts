// Tag (Category) helpers shared by the tag CRUD routes.

export const TAG_PALETTE = ['#7b2d26', '#3f5b52', '#8a6d3b', '#6b7f54', '#4a5a73', '#9a5b3b', '#73506b', '#6b5d4f']

/** URL-safe tag slug. Same rules as the per-card tag route so slugs stay stable. */
export function slugifyTag(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
}

export function tagColor(index: number): string {
  return TAG_PALETTE[index % TAG_PALETTE.length]
}

/**
 * A tag cannot become its own descendant. `parents` maps child id -> parent id.
 * Returns true when re-parenting `id` under `nextParentId` would make a cycle.
 */
export function wouldCycle(parents: Map<string, string | null>, id: string, nextParentId: string | null): boolean {
  let cursor: string | null | undefined = nextParentId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === id) return true
    if (seen.has(cursor)) return true
    seen.add(cursor)
    cursor = parents.get(cursor) ?? null
  }
  return false
}

/** Validate a name off an untrusted JSON body. */
export function parseTagName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || name.length > 60) return null
  return name
}
