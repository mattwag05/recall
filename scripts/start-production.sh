#!/bin/sh
set -eu

# Framework-only restarts never modify the database schema.
# A reviewed schema deployment is separate and must refuse destructive changes.
# Prisma does not manage the derived bookmark_fts tables; do not use
# --accept-data-loss to silently remove them during ordinary application startup.
if [ "${RECALL_APPLY_SCHEMA:-0}" = "1" ]; then
    npx prisma db push
fi
exec node server.js
