import Database from 'better-sqlite3'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const dbPath = (() => {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
  // Strip "file:" prefix
  return url.replace(/^file:/, '')
})()

declare global {
  var __prisma: PrismaClient | undefined
  var __sqlite: Database.Database | undefined
}

export function getPrisma(): PrismaClient {
  if (!global.__prisma) {
    const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
    global.__prisma = new PrismaClient({ adapter })
  }
  return global.__prisma
}

export function getDb(): Database.Database {
  if (!global.__sqlite) {
    global.__sqlite = new Database(dbPath)
    global.__sqlite.pragma('journal_mode = WAL')
    global.__sqlite.pragma('foreign_keys = ON')
  }
  return global.__sqlite
}
