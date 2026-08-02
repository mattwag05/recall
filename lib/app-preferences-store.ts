// Server-only reads and writes for content preferences.
//
// Kept apart from ./app-preferences so the settings page, which is a client
// component, can import the types, defaults, and language list without pulling
// Prisma and better-sqlite3 into the browser bundle. Importing this file from a
// client component fails the build with "Can't resolve 'fs'", which is the
// intended outcome: the split is the guard.

import { getPrisma } from './db'
import {
  PREFERENCE_KEYS,
  parsePreferences,
  preferenceRows,
  type AppPreferences,
} from './app-preferences'

export async function readPreferences(): Promise<AppPreferences> {
  const rows = await getPrisma().setting.findMany({
    where: { key: { in: [...PREFERENCE_KEYS] } },
  })
  const values: Record<string, string> = {}
  for (const row of rows) values[row.key] = row.value
  return parsePreferences(values)
}

export async function writePreferences(patch: Partial<AppPreferences>): Promise<AppPreferences> {
  const prisma = getPrisma()
  for (const [key, value] of preferenceRows(patch)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }
  return readPreferences()
}
