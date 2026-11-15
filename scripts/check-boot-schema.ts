// Execute the production entrypoint with isolated command stand-ins.
// Normal restarts preserve schema; reviewed schema failures prevent startup.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

const boot = join(process.cwd(), 'scripts/start-production.sh')
const root = mkdtempSync(join(tmpdir(), 'recall-boot-check-'))
let passed = 0
try {
  for (const name of ['node', 'npx']) {
    writeFileSync(join(root, name), '#!/bin/sh\nprintf "%s\\n" "' + name + ' $*" >> "$BOOT_TRACE"\n' +
      (name === 'npx' ? 'exit "${SCHEMA_EXIT:-0}"\n' : ''), { mode: 0o700 })
  }
  for (const fixture of [
    { apply: undefined, schemaExit: '0', status: 0, trace: ['node server.js'] },
    { apply: '0', schemaExit: '0', status: 0, trace: ['node server.js'] },
    { apply: 'true', schemaExit: '0', status: 0, trace: ['node server.js'] },
    { apply: '1', schemaExit: '0', status: 0, trace: ['node scripts/drop-fts.cjs', 'npx prisma db push', 'node server.js'] },
    { apply: '1', schemaExit: '7', status: 7, trace: ['node scripts/drop-fts.cjs', 'npx prisma db push'] },
  ]) {
    const trace = join(root, 'trace')
    writeFileSync(trace, '')
    const env: NodeJS.ProcessEnv = {
      PATH: root + ':/usr/bin:/bin',
      BOOT_TRACE: trace,
      SCHEMA_EXIT: fixture.schemaExit,
      NODE_ENV: 'test',
    }
    if (fixture.apply !== undefined) env.RECALL_APPLY_SCHEMA = fixture.apply
    const result = spawnSync('/bin/sh', [boot], { env, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, fixture.status, result.stderr)
    assert.deepEqual(readFileSync(trace, 'utf8').trim().split('\n'), fixture.trace)
    passed++
  }
  // Real push against a database that has the FTS5 tables and a schema change.
  const schema = join(root, 'schema.prisma')
  writeFileSync(schema, readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    .replace('model Bookmark {\n', 'model Bookmark {\n  bootCheckProbe String?\n'))
  const makeDb = (path: string) => {
    const db = new Database(path)
    db.exec('CREATE TABLE Bookmark (id TEXT PRIMARY KEY)')
    db.exec('CREATE VIRTUAL TABLE bookmark_fts USING fts5(title)')
    db.close()
  }
  const push = (path: string) => spawnSync('npx', ['prisma', 'db', 'push', '--schema', schema], {
    env: { ...process.env, DATABASE_URL: 'file:' + path }, encoding: 'utf8', timeout: 120000,
  })
  const before = join(root, 'before.db')
  makeDb(before)
  assert.notEqual(push(before).status, 0, 'push over FTS tables must fail without drop-fts')
  const after = join(root, 'after.db')
  makeDb(after)
  const drop = spawnSync('node', [join(process.cwd(), 'scripts/drop-fts.cjs')], {
    env: { ...process.env, DATABASE_PATH: after }, encoding: 'utf8' })
  assert.equal(drop.status, 0, drop.stderr)
  const pushed = push(after)
  assert.equal(pushed.status, 0, pushed.stdout + pushed.stderr)
  passed += 2
  const fts = readFileSync(join(process.cwd(), 'lib/fts.ts'), 'utf8')
  assert.match(fts, /CREATE VIRTUAL TABLE IF NOT EXISTS bookmark_fts/)
  assert.match(fts, /ftsCount === 0 && bookmarkCount > 0[\s\S]*populateFts/)
  passed += 2
  console.log(`Boot schema: ${passed} passed`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
