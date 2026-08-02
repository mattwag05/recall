// Content preferences: the shapes, defaults, and parsing. NO database access.
//
// These are SERVER preferences in that they change what the enrichment pipeline
// does, so the values live in the Setting table rather than localStorage. But
// the settings page is a client component and needs the types, the defaults,
// and the language list, so this module must stay importable from the browser.
// Reading and writing lives in ./app-preferences-store, which does import
// Prisma. Same split as api-errors (server) and api-client (client).
//
// Importing getPrisma here drags better-sqlite3 into the client bundle and the
// build dies with "Can't resolve 'fs'". Keep this file free of node imports.
//
// ponytail: no defaults table, no migration, no validation library. Unknown or
// missing rows fall back to DEFAULT_PREFERENCES, which is also what a fresh
// install sees, so "never configured" and "configured to the defaults" are
// deliberately indistinguishable.

export type SummaryDepth = 'concise' | 'detailed' | 'off'

export interface AppPreferences {
  /** Notebook/summary depth, or 'off' to skip summarization entirely. */
  autoSummarize: SummaryDepth
  /** Run semantic tagging and categorization on new cards. */
  autoTagging: boolean
  /** Generate entity connections on new cards. */
  autoConnections: boolean
  /** Language generated notebooks and summaries are written in. */
  aiLanguage: string
}

// ponytail: no "search language" preference. Recall has one, but here search is
// FTS5 with a `porter unicode61` tokenizer chosen at index-creation time, so
// changing it means rebuilding bookmark_fts. A dropdown that did not do that
// would be a control that silently does nothing. Add it with the reindex, or
// not at all.

export const DEFAULT_PREFERENCES: AppPreferences = {
  autoSummarize: 'concise',
  autoTagging: true,
  autoConnections: true,
  aiLanguage: 'English',
}

export const PREFERENCE_KEYS = [
  'pref_auto_summarize',
  'pref_auto_tagging',
  'pref_auto_connections',
  'pref_ai_language',
] as const

const SUMMARY_DEPTHS: SummaryDepth[] = ['concise', 'detailed', 'off']

// Kept short and explicit rather than pulling in a locale list: these are the
// languages the summarizer prompt is actually worded for.
export const SUPPORTED_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Japanese',
  'Chinese',
] as const

/** Turn raw Setting rows into preferences. Pure, so it is testable without a DB. */
export function parsePreferences(values: Record<string, string | undefined>): AppPreferences {
  return {
    autoSummarize: asDepth(values.pref_auto_summarize),
    autoTagging: asBoolean(values.pref_auto_tagging, DEFAULT_PREFERENCES.autoTagging),
    autoConnections: asBoolean(values.pref_auto_connections, DEFAULT_PREFERENCES.autoConnections),
    aiLanguage: asLanguage(values.pref_ai_language, DEFAULT_PREFERENCES.aiLanguage),
  }
}

/** The Setting rows a patch should write. Pure, so the store stays trivial. */
export function preferenceRows(patch: Partial<AppPreferences>): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  if (patch.autoSummarize !== undefined) entries.push(['pref_auto_summarize', asDepth(patch.autoSummarize)])
  if (patch.autoTagging !== undefined) entries.push(['pref_auto_tagging', String(Boolean(patch.autoTagging))])
  if (patch.autoConnections !== undefined) entries.push(['pref_auto_connections', String(Boolean(patch.autoConnections))])
  if (patch.aiLanguage !== undefined) entries.push(['pref_ai_language', asLanguage(patch.aiLanguage, DEFAULT_PREFERENCES.aiLanguage)])
  return entries
}

/**
 * The enrichment stages these preferences allow. Turning a stage off here is
 * what "Auto tagging: off" actually means; `runPipeline` already accepts a
 * stage list, so no pipeline surgery is needed.
 *
 * entity_extraction and embedding are never disabled: they are local, cheap,
 * and search plus related-cards stop working without them.
 */
export function enabledStages(prefs: AppPreferences): Array<
  'entity_extraction' | 'semantic_tagging' | 'categorization' | 'summarization' | 'connection_generation' | 'embedding'
> {
  const stages: ReturnType<typeof enabledStages> = ['entity_extraction']
  if (prefs.autoTagging) stages.push('semantic_tagging', 'categorization')
  if (prefs.autoSummarize !== 'off') stages.push('summarization')
  if (prefs.autoConnections) stages.push('connection_generation')
  stages.push('embedding')
  return stages
}

function asDepth(value: unknown): SummaryDepth {
  return SUMMARY_DEPTHS.includes(value as SummaryDepth)
    ? (value as SummaryDepth)
    : DEFAULT_PREFERENCES.autoSummarize
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return fallback
}

function asLanguage(value: unknown, fallback: string): string {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
    ? value
    : fallback
}
