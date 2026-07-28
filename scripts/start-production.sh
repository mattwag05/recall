#!/bin/sh
set -eu

# prisma db push is idempotent — it no-ops when the schema already matches, so
# there is nothing to gain from probing the database first.
npx prisma db push

exec node server.js
