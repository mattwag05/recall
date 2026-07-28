#!/bin/sh
set -eu

# Apply the Prisma schema on boot. No-ops when it already matches.
#
# --accept-data-loss is required, and is safe here for one specific reason:
# the FTS5 search index (bookmark_fts*) is a set of raw SQLite virtual tables
# created by lib/fts.ts, not Prisma models. `db push` therefore sees them as
# unknown tables and insists on dropping them, which it will not do without
# this flag. Losing them costs nothing durable — initFts() in lib/fts.ts
# recreates the table and repopulates it from Bookmark on the next search or
# index call, so the index rebuilds itself on first use.
#
# Do NOT "fix" this by skipping the push when the database already exists.
# That was the previous behaviour and it silently prevented every schema
# change from ever reaching a deployed database.
npx prisma db push --accept-data-loss

exec node server.js
