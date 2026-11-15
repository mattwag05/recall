import assert from 'node:assert/strict'
import { AI_PROVIDER_OPTIONS, type AiProvider } from '../lib/ai-settings'

// recall-mok: every provider in AI_PROVIDER_OPTIONS must have an explicit
// no-think entry, and a truncated completion must throw instead of returning
// a partial body that batched JSON stages would silently mis-parse.
import { LlmTruncatedError, NO_THINK_PARAMS, completionText } from '../lib/ai-client'

// The table must cover every provider option with no gaps.
for (const option of AI_PROVIDER_OPTIONS) {
  assert(
    Object.hasOwn(NO_THINK_PARAMS, option.id),
    `NO_THINK_PARAMS has no entry for provider "${option.id}" — a new AI_PROVIDER_OPTIONS entry must add one`,
  )
}

// The table must not carry entries for providers that no longer exist.
const optionIds = new Set<string>(AI_PROVIDER_OPTIONS.map(option => option.id))
for (const id of Object.keys(NO_THINK_PARAMS)) {
  assert(optionIds.has(id), `NO_THINK_PARAMS has a stale entry for provider "${id}"`)
}

// Reasoning-capable remote providers must actually suppress reasoning.
// (splash/omlx are local non-reasoning engines and legitimately send nothing.)
const mustSuppress: Record<AiProvider, boolean> = {
  splash: false,
  ollama: true,
  lmstudio: true,
  omlx: false,
  openrouter: true,
  // custom is an arbitrary endpoint; strict servers 400 on reasoning_effort.
  custom: false,
}
for (const option of AI_PROVIDER_OPTIONS) {
  const extra = NO_THINK_PARAMS[option.id]
  assert(extra !== undefined, `NO_THINK_PARAMS["${option.id}"] is undefined`)
  if (mustSuppress[option.id]) {
    assert(
      Object.keys(extra).length > 0,
      `provider "${option.id}" is reasoning-capable but noThinkExtra() returns {} — ` +
      'reasoning models will burn max_tokens on chain-of-thought and truncate the JSON payload',
    )
  }
}

assert.deepEqual(NO_THINK_PARAMS.custom, {}, 'custom endpoints must not receive reasoning params')
// reasoning.exclude only hides reasoning; tokens still burn max_tokens.
assert.deepEqual(NO_THINK_PARAMS.openrouter, { reasoning: { effort: 'none' } }, 'openrouter must disable reasoning, not just hide it')

// Truncation detection: finish_reason "length" must throw, never return the partial body.
const ctx = { fn: 'llmChat', maxTokens: 64, provider: 'custom', model: 'm', stage: 's' }
const reply = (content: string | null, finish_reason: string) => ({ choices: [{ message: { content }, finish_reason }] })
assert.equal(completionText(reply('<think>x</think>{"ok":1}', 'stop'), ctx), '{"ok":1}')
assert.equal(completionText(reply(null, 'stop'), ctx), '')
assert.equal(completionText({}, ctx), '')
assert.throws(
  () => completionText(reply('{"tags": ["a", "b', 'length'), ctx),
  (err: unknown) => err instanceof LlmTruncatedError && /max_tokens=64/.test(err.message),
)

console.log('ai no-think params ok')
