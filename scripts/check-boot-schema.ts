// The production boot script runs `prisma db push` against a live database.
// Two ways that has already gone wrong, both guarded here:
//
//  1. Without --accept-data-loss the push ABORTS, because the FTS5 virtual
//     tables (bookmark_fts*) are not Prisma models and it wants to drop them.
//     The container then crash-loops on boot and the app never starts.
//  2. "Fixing" that by skipping the push when the database already exists —
//     the original behaviour — means schema changes never reach a deployed
//     database at all.
//
// Dropping the FTS tables is only acceptable because initFts() rebuilds them,
// so that property is asserted too rather than assumed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
let failed = 0

function check(label: string, fn: () => void) {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL: ${label}\n  ${err instanceof Error ? err.message : String(err)}`)
  }
}

const boot = readFileSync(join(process.cwd(), 'scripts/start-production.sh'), 'utf8')

check('boot script runs prisma db push', () => {
  assert.match(boot, /npx prisma db push/, 'boot must apply the schema')
})

check('the push carries --accept-data-loss', () => {
  assert.match(
    boot,
    /npx prisma db push --accept-data-loss/,
    'without this flag the push aborts on the FTS tables and the container crash-loops',
  )
})

check('the push is unconditional', () => {
  // A guard around the push is how schema changes silently stopped applying.
  assert.ok(
    !/if\s.*prisma db push/s.test(boot),
    'the push must not be conditional on the database already existing',
  )
})

const fts = readFileSync(join(process.cwd(), 'lib/fts.ts'), 'utf8')

check('initFts recreates the FTS table when missing', () => {
  assert.match(fts, /CREATE VIRTUAL TABLE IF NOT EXISTS bookmark_fts/)
})

check('initFts repopulates an empty index from Bookmark', () => {
  // This is what makes dropping the FTS tables on boot recoverable.
  assert.match(fts, /ftsCount === 0 && bookmarkCount > 0.*populateFts/s)
})

console.log(`\nBoot schema: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
