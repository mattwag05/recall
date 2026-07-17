import { getDb } from './db'

const FTS_COLUMNS = [
  'bookmark_id',
  'title',
  'text',
  'body',
  'summary',
  'notebook',
  'semantic_tags',
  'entities',
  'image_tags',
  'categories',
  'quiz',
]

const SURFACE_COLUMNS = {
  notebook: ['title', 'summary', 'notebook', 'categories', 'semantic_tags', 'entities'],
  reader: ['text', 'body', 'image_tags'],
  quiz: ['quiz'],
} as const

export type FtsSearchSurface = keyof typeof SURFACE_COLUMNS

export interface FtsBookmarkDocument {
  bookmarkId: string
  title?: string | null
  text?: string | null
  body?: string | null
  summary?: string | null
  notebookContent?: string | null
  semanticTags?: string | null
  entities?: string | null
  imageTags?: string | null
  imageTagTerms?: string | null
  categories?: string | null
  quiz?: string | null
}

function createFtsTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS bookmark_fts USING fts5(
      bookmark_id UNINDEXED,
      title,
      text,
      body,
      summary,
      notebook,
      semantic_tags,
      entities,
      image_tags,
      categories,
      quiz,
      tokenize='porter unicode61'
    );
  `)
}

function populateFts(db: ReturnType<typeof getDb>) {
  const bookmarks = db.prepare(`
    SELECT b.id, b.title, b.text, b.body, b.summary, b.notebookContent,
           b.semanticTags, b.entities,
           GROUP_CONCAT(DISTINCT c.name || ' ' || c.slug) as categories,
           GROUP_CONCAT(DISTINCT q.prompt || ' ' || q.answer) as quiz
    FROM Bookmark b
    LEFT JOIN BookmarkCategory bc ON bc.bookmarkId = b.id
    LEFT JOIN Category c ON c.id = bc.categoryId
    LEFT JOIN QuizQuestion q ON q.bookmarkId = b.id
    GROUP BY b.id
  `).all() as Array<{
    id: string
    title: string | null
    text: string | null
    body: string | null
    summary: string | null
    notebookContent: string | null
    semanticTags: string | null
    entities: string | null
    categories: string | null
    quiz: string | null
  }>

  const insert = db.prepare(`
    INSERT INTO bookmark_fts(bookmark_id, title, text, body, summary, notebook, semantic_tags, entities, image_tags, categories, quiz)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction((rows: typeof bookmarks) => {
    for (const row of rows) {
      insert.run(
        row.id,
        row.title ?? '',
        row.text ?? '',
        row.body ?? '',
        row.summary ?? '',
        row.notebookContent ?? '',
        jsonStringArrayTerms(row.semanticTags),
        entityTerms(row.entities),
        imageTagTermsForBookmark(db, row.id),
        row.categories ?? '',
        row.quiz ?? ''
      )
    }
  })
  insertAll(bookmarks)
}

export function initFts() {
  const db = getDb()
  createFtsTable(db)

  const columns = db.prepare(`PRAGMA table_info(bookmark_fts)`).all() as Array<{ name: string }>
  const names = new Set(columns.map(c => c.name))
  const needsRebuild = FTS_COLUMNS.some(name => !names.has(name))

  if (needsRebuild) {
    db.exec(`DROP TABLE IF EXISTS bookmark_fts`)
    createFtsTable(db)
    populateFts(db)
    return
  }

  const ftsCount = (db.prepare(`SELECT COUNT(*) as count FROM bookmark_fts`).get() as { count: number }).count
  const bookmarkCount = (db.prepare(`SELECT COUNT(*) as count FROM Bookmark`).get() as { count: number }).count
  if (ftsCount === 0 && bookmarkCount > 0) populateFts(db)
}

export function rebuildFts() {
  const db = getDb()
  initFts()
  db.exec(`DELETE FROM bookmark_fts`)
  populateFts(db)
}

export function ftsSearch(query: string, surfaces?: FtsSearchSurface[]): string[] {
  const db = getDb()
  initFts()
  // Sanitize: remove FTS5 special characters and strip boolean operators
  const sanitized = query
    .replace(/['"*^:()\-{}\[\]]/g, ' ')
    .replace(/\b(OR|AND|NOT)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!sanitized) return []
  const columns = columnsForSurfaces(surfaces)
  const matchQuery = columns.length > 0 ? `{${columns.join(' ')}} : ${sanitized}` : sanitized

  try {
    const results = db.prepare(`
      SELECT bookmark_id
      FROM bookmark_fts
      WHERE bookmark_fts MATCH ?
      ORDER BY rank
      LIMIT 150
    `).all(matchQuery) as Array<{ bookmark_id: string }>
    return results.map(r => r.bookmark_id)
  } catch (err) {
    throw new Error(`FTS search failed: ${String(err)}`)
  }
}

export function removeFromFts(bookmarkId: string) {
  const db = getDb()
  initFts()
  db.prepare(`DELETE FROM bookmark_fts WHERE bookmark_id = ?`).run(bookmarkId)
}

function categoryTermsForBookmark(db: ReturnType<typeof getDb>, bookmarkId: string): string {
  const row = db.prepare(`
    SELECT GROUP_CONCAT(c.name || ' ' || c.slug, ' ') as categories
    FROM BookmarkCategory bc
    JOIN Category c ON c.id = bc.categoryId
    WHERE bc.bookmarkId = ?
  `).get(bookmarkId) as { categories: string | null } | undefined

  return row?.categories ?? ''
}

function quizTermsForBookmark(db: ReturnType<typeof getDb>, bookmarkId: string): string {
  const row = db.prepare(`
    SELECT GROUP_CONCAT(prompt || ' ' || answer, ' ') as quiz
    FROM QuizQuestion
    WHERE bookmarkId = ?
  `).get(bookmarkId) as { quiz: string | null } | undefined

  return row?.quiz ?? ''
}

function uniqueTerms(values: string[]): string {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].join(' ')
}

function jsonStringArrayTerms(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return ''
    return uniqueTerms(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return ''
  }
}

function entityTerms(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
    return uniqueTerms(collectStringValues(parsed))
  } catch {
    return ''
  }
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStringValues)
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(collectStringValues)
  }
  return []
}

function imageTagJsonTerms(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value) as unknown
    const rawTags = Array.isArray(parsed)
      ? parsed
      : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).tags)
        ? (parsed as Record<string, unknown>).tags as unknown[]
        : []
    return uniqueTerms(rawTags.filter((tag): tag is string => typeof tag === 'string'))
  } catch {
    return ''
  }
}

function imageTagTermsForBookmark(db: ReturnType<typeof getDb>, bookmarkId: string): string {
  const rows = db.prepare(`
    SELECT imageTags
    FROM MediaItem
    WHERE bookmarkId = ? AND imageTags IS NOT NULL
  `).all(bookmarkId) as Array<{ imageTags: string | null }>

  return uniqueTerms(rows.flatMap(row => imageTagJsonTerms(row.imageTags).split(/\s+/)))
}

export function indexBookmark(doc: FtsBookmarkDocument) {
  const db = getDb()
  initFts()
  db.prepare(`DELETE FROM bookmark_fts WHERE bookmark_id = ?`).run(doc.bookmarkId)
  db.prepare(`
    INSERT INTO bookmark_fts(bookmark_id, title, text, body, summary, notebook, semantic_tags, entities, image_tags, categories, quiz)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    doc.bookmarkId,
    doc.title ?? '',
    doc.text ?? '',
    doc.body ?? '',
    doc.summary ?? '',
    doc.notebookContent ?? '',
    jsonStringArrayTerms(doc.semanticTags),
    entityTerms(doc.entities),
    doc.imageTagTerms ?? imageTagJsonTerms(doc.imageTags),
    doc.categories ?? categoryTermsForBookmark(db, doc.bookmarkId),
    doc.quiz ?? quizTermsForBookmark(db, doc.bookmarkId)
  )
}

export function indexBookmarkById(bookmarkId: string) {
  const db = getDb()
  initFts()

  const row = db.prepare(`
    SELECT b.id, b.title, b.text, b.body, b.summary, b.notebookContent,
           b.semanticTags, b.entities,
           GROUP_CONCAT(DISTINCT c.name || ' ' || c.slug) as categories,
           GROUP_CONCAT(DISTINCT q.prompt || ' ' || q.answer) as quiz
    FROM Bookmark b
    LEFT JOIN BookmarkCategory bc ON bc.bookmarkId = b.id
    LEFT JOIN Category c ON c.id = bc.categoryId
    LEFT JOIN QuizQuestion q ON q.bookmarkId = b.id
    WHERE b.id = ?
    GROUP BY b.id
  `).get(bookmarkId) as {
    id: string
    title: string | null
    text: string | null
    body: string | null
    summary: string | null
    notebookContent: string | null
    semanticTags: string | null
    entities: string | null
    categories: string | null
    quiz: string | null
  } | undefined

  if (!row) {
    removeFromFts(bookmarkId)
    return
  }

  indexBookmark({
    bookmarkId: row.id,
    title: row.title,
    text: row.text,
    body: row.body,
    summary: row.summary,
    notebookContent: row.notebookContent,
    semanticTags: row.semanticTags,
    entities: row.entities,
    imageTagTerms: imageTagTermsForBookmark(db, row.id),
    categories: row.categories,
    quiz: row.quiz,
  })
}

function columnsForSurfaces(surfaces?: FtsSearchSurface[]): string[] {
  if (!surfaces || surfaces.length === 0) return []
  const columns = new Set<string>()
  for (const surface of surfaces) {
    for (const column of SURFACE_COLUMNS[surface]) columns.add(column)
  }
  return [...columns]
}
