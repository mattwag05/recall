import OpenAI from 'openai'
import { getPrisma } from './db'
import { normalizeAiProvider, providerDefaults, providerNeedsKey, type AiProvider } from './ai-settings'

/**
 * LLM client for Recall.
 *
 * Provider-aware so the prototype can run fully local:
 *   - "omlx"   → local OpenAI-compatible server (default)
 *   - "ollama" → Ollama OpenAI-compatible server (fallback)
 *
 * Both are thinking models; we disable thinking per-provider so structured
 * (JSON) stages don't burn the token budget on reasoning:
 *   - local server (Qwen3.6): chat_template_kwargs.enable_thinking = false
 *   - Ollama (gemma4): reasoning_effort = "none"
 */

const OMLX_BASE = process.env.OMLX_BASE_URL || 'http://localhost:8000/v1'
const OMLX_KEY = process.env.OMLX_API_KEY || ''
const OMLX_MODEL = process.env.OMLX_MODEL || 'Qwen3.6-35B-A3B-4bit'

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
export const getOpenRouterClient = getLLMClient

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

/** Extra request params that disable the model's chain-of-thought. */
function noThinkExtra(provider: AiProvider): Record<string, unknown> {
  return provider === 'ollama'
    ? { reasoning_effort: 'none' }
    : provider === 'omlx'
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {}
}

/** Defensive strip of any reasoning that still leaks into content. */
export function stripThinking(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*Thinking Process:[\s\S]*?(?=(\[|\{|#|$))/i, '')
    .trim()
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
 */
export async function llmChat(messages: ChatMessage[], opts: LlmChatOpts = {}): Promise<string> {
  const settings = await getRuntimeLlmSettings()
  const client = await getLLMClient()
  const model = opts.model ?? (await getModel(opts.stage ?? 'default'))
  const finalMessages: ChatMessage[] = opts.system
    ? [{ role: 'system', content: opts.system }, ...messages]
    : messages

  const resp = await withTimeout(client.chat.completions.create({
    model,
    messages: finalMessages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1024,
    ...noThinkExtra(settings.provider),
    // chat_template_kwargs is not in the OpenAI type but local OpenAI-compatible servers honor it.
  } as unknown as Parameters<typeof client.chat.completions.create>[0], {
    timeout: settings.requestTimeoutMs,
  }), settings.requestTimeoutMs)

  const content = (resp as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content ?? ''
  return stripThinking(content)
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
  const resp = await withTimeout(client.chat.completions.create({
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
  }), settings.requestTimeoutMs)

  const content = (resp as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content ?? ''
  return stripThinking(content)
}

export async function getRuntimeLlmSettings(): Promise<RuntimeLlmSettings> {
  const values = await readAiSettingValues()
  const provider = normalizeProvider(values.llm_provider ?? process.env.LLM_PROVIDER ?? 'omlx')
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
  return provider === 'custom' && !value ? 'omlx' : provider
}

function envBaseUrl(provider: AiProvider): string {
  if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL
  if (provider === 'ollama') return process.env.OLLAMA_BASE_URL || OLLAMA_BASE
  if (provider === 'lmstudio') return process.env.LMSTUDIO_BASE_URL || ''
  if (provider === 'omlx') return OMLX_BASE
  if (provider === 'openrouter') return process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  return ''
}

function envModel(provider: AiProvider): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL
  if (provider === 'ollama') return OLLAMA_MODEL
  if (provider === 'lmstudio') return process.env.LMSTUDIO_MODEL || ''
  if (provider === 'omlx') return OMLX_MODEL
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || ''
  return ''
}

function envApiKey(provider: AiProvider): string {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY
  if (provider === 'omlx') return OMLX_KEY
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY || ''
  return ''
}

function requestTimeoutMs(value?: string): number {
  const raw = Number(value ?? process.env.LLM_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS)
  if (!Number.isFinite(raw)) return DEFAULT_REQUEST_TIMEOUT_MS
  return Math.min(300000, Math.max(5000, Math.round(raw)))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
