#!/bin/sh
set -eu

DB_PATH="${DATABASE_PATH:-/data/recall.db}"

needs_schema=0
if [ ! -s "$DB_PATH" ]; then
  needs_schema=1
else
  if ! node <<'NODE'
const Database = require('better-sqlite3')
const dbPath = process.env.DATABASE_PATH || '/data/recall.db'
try {
  const db = new Database(dbPath, { readonly: true })
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Bookmark'").get()
  db.close()
  process.exit(row ? 0 : 1)
} catch {
  process.exit(1)
}
NODE
  then
    needs_schema=1
  fi
fi

if [ "$needs_schema" = "1" ]; then
  echo "Initializing Recall database schema at $DB_PATH"
  npx prisma db push
else
  echo "Existing Recall database schema detected at $DB_PATH; skipping prisma db push"
fi

exec node server.js
