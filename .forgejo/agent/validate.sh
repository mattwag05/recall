#!/usr/bin/env bash
set -euo pipefail
# The controller supplies an ephemeral HOME and excludes publication credentials.
export DATABASE_URL="file:$HOME/recall-validation.db"
export NEXT_TELEMETRY_DISABLED=1
npm ci
npm test
npm run lint
npx --no-install tsc --noEmit --incremental false
npm run build
