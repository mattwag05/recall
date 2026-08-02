// Guards lib/app-preferences.ts: preference parsing must never throw on junk
// from the Setting table, and the stage list must actually reflect the toggles.
// This is the file that decides whether an enrichment stage runs, so a silent
// fallback to "everything on" would quietly spend tokens the user turned off.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_PREFERENCES,
  enabledStages,
  parsePreferences,
  type AppPreferences,
} from '../lib/app-preferences'

// A fresh install reads no rows at all.
assert.deepEqual(parsePreferences({}), DEFAULT_PREFERENCES, 'empty settings should give the defaults')

// Junk in the table must fall back, not crash and not leak through.
const junk = parsePreferences({
  pref_auto_summarize: 'exhaustive',
  pref_auto_tagging: 'yes',
  pref_auto_connections: '1',
  pref_ai_language: 'Klingon',
})
assert.deepEqual(junk, DEFAULT_PREFERENCES, 'unrecognised values should fall back to the defaults')

// Real values round-trip.
const real = parsePreferences({
  pref_auto_summarize: 'detailed',
  pref_auto_tagging: 'false',
  pref_auto_connections: 'false',
  pref_ai_language: 'Japanese',
})
assert.equal(real.autoSummarize, 'detailed')
assert.equal(real.autoTagging, false)
assert.equal(real.autoConnections, false)
assert.equal(real.aiLanguage, 'Japanese')

// Defaults run every stage.
const allOn = enabledStages(DEFAULT_PREFERENCES)
for (const stage of [
  'entity_extraction',
  'semantic_tagging',
  'categorization',
  'summarization',
  'connection_generation',
  'embedding',
]) {
  assert.ok(allOn.includes(stage as (typeof allOn)[number]), `default preferences should run ${stage}`)
}

// Each toggle must actually remove its stage. This is the assertion that would
// fail if someone "simplified" enabledStages back to a constant list.
const off: AppPreferences = {
  autoSummarize: 'off',
  autoTagging: false,
  autoConnections: false,
  aiLanguage: 'English',
}
const allOff = enabledStages(off)
assert.ok(!allOff.includes('summarization'), 'autoSummarize=off should skip summarization')
assert.ok(!allOff.includes('semantic_tagging'), 'autoTagging=false should skip semantic tagging')
assert.ok(!allOff.includes('categorization'), 'autoTagging=false should skip categorization')
assert.ok(!allOff.includes('connection_generation'), 'autoConnections=false should skip connection generation')

// Local, cheap stages that search depends on stay on no matter what: turning
// them off would break search and related cards with no way to notice.
assert.ok(allOff.includes('entity_extraction'), 'entity extraction should never be disabled')
assert.ok(allOff.includes('embedding'), 'embedding should never be disabled')

// Turning one thing off must not turn anything else off.
const tagsOnly = enabledStages({ ...DEFAULT_PREFERENCES, autoTagging: false })
assert.ok(tagsOnly.includes('summarization'), 'disabling tagging should not disable summarization')
assert.ok(tagsOnly.includes('connection_generation'), 'disabling tagging should not disable connections')

// lib/app-preferences.ts is imported by app/settings/page.tsx, which is a
// client component. If it ever imports the database (directly or via a module
// that does), Next drags better-sqlite3 into the browser bundle and the
// production build fails with "Can't resolve 'fs'". CI marks the build
// non-blocking, so nothing else in this repo would catch that.
const preferencesSource = readFileSync(new URL('../lib/app-preferences.ts', import.meta.url), 'utf8')
for (const forbidden of ['./db', '@/lib/db', 'better-sqlite3', 'node:fs', './app-preferences-store']) {
  assert.ok(
    !preferencesSource.includes(`from '${forbidden}'`),
    `lib/app-preferences.ts must stay client-safe, but it imports ${forbidden}. ` +
      'Put database access in lib/app-preferences-store.ts instead.'
  )
}

console.log('app-preferences checks passed')
