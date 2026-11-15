import OpenAI from 'openai'
import { getPrisma } from './db'
import { normalizeAiProvider, providerDefaults, providerNeedsKey, type AiProvider } from './ai-settings'

/**
 * LLM client for Recall.
 *
 * Provider-aware so the prototype can run fully local:
 *   - "splash" → local OpenAI-compatible text server (default)
 *   - "omlx"   → local vision server
 *   - "ollama" → Ollama OpenAI-compatible server (fallback)
 *
 * We disable reasoning per provider so structured JSON stages do not burn the
 * token budget on a hidden chain-of-thought pass (see NO_THINK_PARAMS below).
 * llmChat also fails loudly when the response is truncated (finish_reason
 * "length") instead of returning a partial body.
 */

const SPLASH_BASE = process.env.SPLASH_BASE_URL || 'http://127.0.0.1:8000/v1'
const SPLASH_KEY = process.env.SPLASH_API_KEY || ''
const SPLASH_MODEL = process.env.SPLASH_MODEL || 'Qwen3.8-27B-Splash'

const OMLX_BASE = process.env.OMLX_BASE_URL || 'http://localhost:8000/v1'
const OMLX_KEY = process.env.OMLX_API_KEY || ''
const OMLX_MODEL = process.env.OMLX_MODEL || 'MiniCPM-V-4.6-4bit'

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:latest'
const VISION_MODEL = process.env.VISION_MODEL || ''
const DEFAULT_REQUEST_TIMEOUT_MS = 30000

let _client: { key: string; client: OpenAI } | undefined

interface RuntimeLlmSettings {
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
  requestTimeoutMs: number
}

export async function getLLMClient(): Promise<OpenAI> {
  const settings = await getRuntimeLlmSettings()
  const cacheKey = `${settings.provider}|${settings.baseUrl}|${settings.apiKey}`
  if (_client?.key === cacheKey) return _client.client
  if (providerNeedsKey(settings.provider) && !settings.apiKey) {
    throw new Error(`${settings.provider} API key is not set. Add it in Settings → AI endpoint or the matching environment variable.`)
  }
  const client = new OpenAI({ baseURL: settings.baseUrl, apiKey: settings.apiKey || settings.provider })
  _client = { key: cacheKey, client }
  return client
}

/** Back-compat alias — the forked engine imports this name. */

export async function getModel(stage: string): Promise<string> {
  // Per-stage override via Settings (model_<stage>), else provider default.
  try {
    const prisma = getPrisma()
    const setting = await prisma.setting.findUnique({ where: { key: `model_${stage}` } })
    if (setting?.value) return setting.value
  } catch {}
  if (stage === 'vision' && VISION_MODEL) return VISION_MODEL
  return (await getRuntimeLlmSettings()).model
}

/**
 * Per-provider params that suppress chain-of-thought. Driven off a table keyed
 * by every id in AI_PROVIDER_OPTIONS so a new provider cannot silently miss it
 * (the old if-chain only covered ollama; openrouter/lmstudio/custom sent
 * nothing and reasoning models burned max_tokens on CoT — recall-mok).
 *
 *   - ollama:   Ollama's OpenAI-compat layer honors reasoning_effort.
 *   - openrouter: effort "none" disables reasoning. reasoning.exclude only
 *     hides it; the tokens still count against max_tokens. Models whose
 *     reasoning is mandatory reject "none" with a 400, which is loud.
 *   - lmstudio: honors reasoning_effort and ignores it for non-reasoning models.
 *   - custom: an arbitrary OpenAI-compatible endpoint. Strict servers (OpenAI
 *     itself) reject reasoning_effort for non-reasoning models with a 400, so
 *     send nothing and rely on the truncation check in completionText().
 *   - splash / omlx: local engines that are not reasoning models.
 */
export const NO_THINK_PARAMS: Record<AiProvider, Record<string, unknown>> = {
  splash: {},
  ollama: { reasoning_effort: 'none' },
  lmstudio: { reasoning_effort: 'none' },
  omlx: {},
  openrouter: { reasoning: { effort: 'none' } },
  custom: {},
}

/** Extra request params that disable the model's chain-of-thought. */
function noThinkExtra(provider: AiProvider): Record<string, unknown> {
  return NO_THINK_PARAMS[provider] ?? {}
}

/** Defensive strip of any reasoning that still leaks into content. */
export function stripThinking(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*Thinking Process:[\s\S]*?(?=(\[|\{|#|$))/i, '')
    .trim()
}

/** Thrown when the model hit max_tokens (finish_reason "length"). */
export class LlmTruncatedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmTruncatedError'
  }
}

/**
 * Cleaned content of the first choice. Throws LlmTruncatedError on
 * finish_reason "length" so a cut-off reply is never returned as if complete.
 */
export function completionText(
  resp: unknown,
  ctx: { fn: string; maxTokens: number; provider: string; model: string; stage: string },
): string {
  const choice = (resp as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> })
    .choices?.[0]
  if (choice?.finish_reason === 'length') {
    throw new LlmTruncatedError(
      `${ctx.fn}: response truncated at max_tokens=${ctx.maxTokens} ` +
      `(provider=${ctx.provider}, model=${ctx.model}, stage=${ctx.stage}). ` +
      'Raise maxTokens or shrink the request; the partial body was discarded.',
    )
  }
  return stripThinking(choice?.message?.content ?? '')
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface LlmChatOpts {
  stage?: string
  model?: string
  system?: string
  temperature?: number
  maxTokens?: number
}

/**
 * Single entry point for chat completions. Injects the no-think param for the
 * active provider and returns cleaned content text.
 *
 * Throws when the response is truncated (finish_reason "length") so callers
 * can distinguish a cut-off reply from a short one. Batched JSON stages
 * (categorizer, semantic-tagger) catch this and fall back per batch instead of
 * silently enriching with a partial body — recall-mok.
 */
export async function llmChat(messages: ChatMessage[], opts: LlmChatOpts = {}): Promise<string> {
  const settings = await getRuntimeLlmSettings()
  const client = await getLLMClient()
  const model = opts.model ?? (await getModel(opts.stage ?? 'default'))
  const finalMessages: ChatMessage[] = opts.system
    ? [{ role: 'system', content: opts.system }, ...messages]
    : messages

  const resp = await client.chat.completions.create({
    model,
    messages: finalMessages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1024,
    ...noThinkExtra(settings.provider),
    // reasoning / chat_template_kwargs are not in the OpenAI type but
    // OpenRouter and local OpenAI-compatible servers honor them.
  } as unknown as Parameters<typeof client.chat.completions.create>[0], {
    timeout: settings.requestTimeoutMs,
  })

  return completionText(resp, { fn: 'llmChat', maxTokens: opts.maxTokens ?? 1024, provider: settings.provider, model, stage: opts.stage ?? 'default' })
}

export async function llmVision(
  prompt: string,
  image: { data: Uint8Array; mimeType: string },
  opts: LlmChatOpts = {},
): Promise<string> {
  const settings = await getRuntimeLlmSettings()
  const client = await getLLMClient()
  const model = opts.model ?? (await getModel(opts.stage ?? 'vision'))
  const base64 = Buffer.from(image.data).toString('base64')
  const resp = await client.chat.completions.create({
    model,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${base64}` } },
        ],
      },
    ],
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 900,
    ...noThinkExtra(settings.provider),
  } as unknown as Parameters<typeof client.chat.completions.create>[0], {
    timeout: settings.requestTimeoutMs,
  })

  return completionText(resp, { fn: 'llmVision', maxTokens: opts.maxTokens ?? 900, provider: settings.provider, model, stage: opts.stage ?? 'vision' })
}

export async function getRuntimeLlmSettings(): Promise<RuntimeLlmSettings> {
  const values = await readAiSettingValues()
  const provider = normalizeProvider(values.llm_provider ?? process.env.LLM_PROVIDER ?? 'splash')
  const defaults = providerDefaults(provider)
  const baseUrl = values.llm_base_url || envBaseUrl(provider) || defaults.defaultBaseUrl
  const apiKey = values.llm_api_key || envApiKey(provider)
  const model = values.llm_model || envModel(provider) || defaults.defaultModel
  return {
    provider,
    baseUrl,
    apiKey,
    model,
    requestTimeoutMs: requestTimeoutMs(values.llm_request_timeout_ms),
  }
}

async function readAiSettingValues(): Promise<Record<string, string>> {
  try {
    const rows = await getPrisma().setting.findMany({
      where: { key: { in: ['llm_provider', 'llm_base_url', 'llm_model', 'llm_api_key', 'llm_request_timeout_ms'] } },
    })
    return Object.fromEntries(rows.map(row => [row.key, row.value]))
  } catch {
    return {}
  }
}

function normalizeProvider(value: string | null | undefined): AiProvider {
  const provider = normalizeAiProvider(value)
  return provider === 'custom' && !value ? 'splash' : provider
}

function envBaseUrl(provider: AiProvider): string {
  if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL
  if (provider === 'splash') return SPLASH_BASE
  if (provider === 'ollama') return process.env.OLLAMA_BASE_URL || OLLAMA_BASE
  if (provider === 'lmstudio') return process.env.LMSTUDIO_BASE_URL || ''
  if (provider === 'omlx') return OMLX_BASE
  if (provider === 'openrouter') return process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  return ''
}

function envModel(provider: AiProvider): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL
  if (provider === 'splash') return SPLASH_MODEL
  if (provider === 'ollama') return OLLAMA_MODEL
  if (provider === 'lmstudio') return process.env.LMSTUDIO_MODEL || ''
  if (provider === 'omlx') return OMLX_MODEL
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || ''
  return ''
}

function envApiKey(provider: AiProvider): string {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY
  if (provider === 'splash') return SPLASH_KEY
  if (provider === 'omlx') return OMLX_KEY
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY || ''
  return ''
}

function requestTimeoutMs(value?: string): number {
  const raw = Number(value ?? process.env.LLM_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS)
  if (!Number.isFinite(raw)) return DEFAULT_REQUEST_TIMEOUT_MS
  return Math.min(300000, Math.max(5000, Math.round(raw)))
}
