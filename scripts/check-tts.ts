import assert from 'node:assert/strict'
import { __ttsTest } from '../lib/tts'
import { isAllowedVoice, normalizeVoice, DEFAULT_TTS_VOICE, langCodeForVoice, languageForVoice, voicesForLanguage, TTS_LANGUAGES } from '../lib/tts-preferences'

const { spokenText, summaryForSpeech } = __ttsTest

// Voice allowlist: only curated ids pass; anything else falls back to default.
assert.equal(isAllowedVoice('af_heart'), true)
assert.equal(isAllowedVoice('am_michael'), true)
assert.equal(isAllowedVoice('bf_emma'), true)
assert.equal(isAllowedVoice('evil_injection'), false)
assert.equal(isAllowedVoice(42), false)
assert.equal(isAllowedVoice(undefined), false)
assert.equal(normalizeVoice('af_bella'), 'af_bella')
assert.equal(normalizeVoice('nope'), DEFAULT_TTS_VOICE)

// Language helpers: lang_code is the voice's first letter; voices group by lang.
assert.equal(langCodeForVoice('af_heart'), 'a')
assert.equal(langCodeForVoice('bf_emma'), 'b')
assert.equal(langCodeForVoice('zm_yunxi'), 'z')
assert.equal(langCodeForVoice('bogus'), DEFAULT_TTS_VOICE[0]) // injection-safe fallback
assert.equal(languageForVoice('bf_emma'), 'en-GB')
assert.equal(languageForVoice('ef_dora'), 'es')
assert.ok(voicesForLanguage('en-GB').every(v => v.lang === 'en-GB'))
assert.ok(voicesForLanguage('en-GB').length >= 2)
// Every language has at least one voice, and every voice's lang is a real language.
const langCodes = new Set(TTS_LANGUAGES.map(l => l.code))
assert.ok(TTS_LANGUAGES.every(l => voicesForLanguage(l.code).length >= 1))
assert.ok(voicesForLanguage('en-US').every(v => langCodes.has(v.lang)))

// Markdown is stripped to clean spoken text.
assert.equal(spokenText('# Heading\n\nSome **bold** and `code` text.'), 'Heading Some bold and code text.')
assert.equal(spokenText('See [the docs](https://x.com) and [[Another Card]].'), 'See the docs and Another Card.')
assert.equal(spokenText('- one\n- two\n- three'), 'one two three')
assert.equal(spokenText('```js\nconst x = 1\n```\nAfter code.'), 'After code.')
assert.equal(spokenText('   \n  '), '')

// summaryForSpeech prefers summary, prefixes the title.
assert.equal(
  summaryForSpeech({ title: 'My Card', summary: 'A short recap.', notebookContent: '# TL;DR\nlong', body: 'x' }),
  'My Card. A short recap.',
)
// Falls through to notebook, then body, when earlier fields are empty.
assert.equal(summaryForSpeech({ title: 'T', summary: '', notebookContent: '## Notes\nbody text', body: 'x' }), 'T. Notes body text')
assert.equal(summaryForSpeech({ title: '', summary: null, notebookContent: null, body: 'just body' }), 'just body')
assert.equal(summaryForSpeech({ title: 'Only title', summary: null, notebookContent: null, body: null }), 'Only title')

console.log('tts checks passed')
