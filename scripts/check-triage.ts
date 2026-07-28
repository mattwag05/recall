// Locks the inbox's two load-bearing decisions: which values are a valid
// triage state, and exactly which cards the inbox claims.
import assert from 'node:assert/strict'
import { TRIAGE_STATUSES, inboxWhere, parseTriageStatus } from '../lib/triage'

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

check('exactly four triage states', () => {
  assert.deepEqual([...TRIAGE_STATUSES], ['new', 'reviewed', 'pinned', 'archived'])
})

for (const value of TRIAGE_STATUSES) {
  check(`accepts ${value}`, () => assert.equal(parseTriageStatus(value), value))
}

for (const value of ['', 'NEW', 'Archived', 'deleted', 'organizing', 'ready', null, undefined, 3, {}, ['new']]) {
  check(`rejects ${JSON.stringify(value)}`, () => assert.equal(parseTriageStatus(value), null))
}

check('inbox claims only unreviewed cards that finished processing', () => {
  assert.deepEqual(inboxWhere(), { triageStatus: 'new', status: { in: ['ready', 'failed'] } })
})

check('inbox excludes mid-pipeline cards', () => {
  const statuses = inboxWhere().status.in
  assert.ok(!statuses.includes('organizing'), 'organizing cards must not reach the inbox')
  assert.ok(!statuses.includes('summarizing'), 'summarizing cards must not reach the inbox')
})

check('inbox includes failed cards so they can be triaged, not stranded', () => {
  assert.ok(inboxWhere().status.in.includes('failed'))
})

console.log(`\nTriage: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
