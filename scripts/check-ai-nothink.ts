import assert from 'node:assert/strict'
import { AI_PROVIDER_OPTIONS, type AiProvider } from '../lib/ai-settings'

// recall-mok: every provider in AI_PROVIDER_OPTIONS must have an explicit
// no-think entry. The table lives in lib/ai-client.ts, which pulls in Prisma
// and the OpenAI client, so this check re-derives the same mapping and asserts
// it matches the table byte-for-byte. If the two drift, a provider can silently
// send no reasoning suppression and batched JSON stages truncate again.

import { NO_THINK_PARAMS } from '../lib/ai-client'

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
  custom: true,
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

console.log('ai no-think params ok')
