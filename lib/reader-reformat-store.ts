// Reader "reformat" output used to live in component state, so a tab switch or
// a reload silently threw away a result the user waited on the LLM for.
//
// This keeps it in localStorage per card. That survives both, but it is
// per-browser: the durable fix is a nullable `readerReformatted` column on
// Bookmark written by POST /api/cards/[id]/reader/reformat, which needs a schema
// change and so is not done here.

const STORE_KEY = 'recall:reader-reformat:v1'
/** Reformats run ~10 KB each; a handful stays well inside the localStorage budget. */
const MAX_CARDS = 5

export interface ReaderReformatEntry {
  text: string
  savedAt: number
}

export type ReaderReformatStore = Record<string, ReaderReformatEntry>

export function parseReformatStore(raw: string | null): ReaderReformatStore {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const store: ReaderReformatStore = {}
  for (const [cardId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    if (typeof entry.text !== 'string' || !entry.text) continue
    store[cardId] = { text: entry.text, savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : 0 }
  }
  return store
}

/** Newest MAX_CARDS entries win; the rest are dropped. */
export function pruneReformatStore(store: ReaderReformatStore, max = MAX_CARDS): ReaderReformatStore {
  const entries = Object.entries(store).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, Math.max(1, max))
  return Object.fromEntries(entries)
}

export function readReaderReformat(cardId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return parseReformatStore(localStorage.getItem(STORE_KEY))[cardId]?.text ?? null
  } catch {
    return null
  }
}

export function writeReaderReformat(cardId: string, text: string) {
  if (typeof window === 'undefined') return
  try {
    const store = parseReformatStore(localStorage.getItem(STORE_KEY))
    store[cardId] = { text, savedAt: Date.now() }
    localStorage.setItem(STORE_KEY, JSON.stringify(pruneReformatStore(store)))
  } catch {
    // Over quota: keep only this card's reformat rather than losing the fresh one.
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ [cardId]: { text, savedAt: Date.now() } }))
    } catch {}
  }
}
