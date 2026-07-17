import { NextResponse } from 'next/server'
import { AI_PROVIDER_OPTIONS, normalizeAiProvider, providerDefaults, type AiProvider } from '@/lib/ai-settings'
import { getPrisma } from '@/lib/db'

export const runtime = 'nodejs'

const SETTING_KEYS = [
  'llm_provider',
  'llm_base_url',
  'llm_model',
  'llm_api_key',
  'llm_request_timeout_ms',
  'embedding_base_url',
  'embedding_model',
  'embedding_api_key',
] as const

export async function GET() {
  const values = await readSettings()
  const provider = normalizeProvider(values.llm_provider ?? process.env.LLM_PROVIDER ?? 'omlx')
  const defaults = providerDefaults(provider)
  const baseUrl = values.llm_base_url || envBaseUrl(provider) || defaults.defaultBaseUrl
  const model = values.llm_model || envModel(provider) || defaults.defaultModel
  const apiKeySet = Boolean(values.llm_api_key || envApiKey(provider))
  const embeddingBaseUrl = values.embedding_base_url || process.env.EMBEDDING_BASE_URL || baseUrl
  const embeddingModel = values.embedding_model || process.env.EMBEDDING_MODEL || 'nomic-embed-text:v1.5'
  const embeddingApiKeySet = Boolean(values.embedding_api_key || process.env.EMBEDDING_API_KEY || values.llm_api_key || envApiKey(provider))
  const requestTimeoutMs = timeoutValue(values.llm_request_timeout_ms ?? process.env.LLM_REQUEST_TIMEOUT_MS)

  return NextResponse.json({
    providers: AI_PROVIDER_OPTIONS,
    settings: {
      provider,
      baseUrl,
      model,
      apiKeySet,
      embeddingBaseUrl,
      embeddingModel,
      embeddingApiKeySet,
      requestTimeoutMs,
    },
  })
}

export async function PATCH(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const updates = new Map<string, string | null>()

  try {
    if ('provider' in data) updates.set('llm_provider', normalizeProvider(stringValue(data.provider)))
    if ('baseUrl' in data) updates.set('llm_base_url', normalizeBaseUrl(data.baseUrl, false))
    if ('model' in data) updates.set('llm_model', stringValue(data.model))
    if ('apiKey' in data) updates.set('llm_api_key', secretValue(data.apiKey))
    if ('embeddingBaseUrl' in data) updates.set('embedding_base_url', normalizeBaseUrl(data.embeddingBaseUrl, false))
    if ('embeddingModel' in data) updates.set('embedding_model', stringValue(data.embeddingModel))
    if ('embeddingApiKey' in data) updates.set('embedding_api_key', secretValue(data.embeddingApiKey))
    if ('requestTimeoutMs' in data) updates.set('llm_request_timeout_ms', String(timeoutValue(data.requestTimeoutMs)))
  } catch (err) {
    if (err instanceof AiSettingsError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }

  if (updates.size === 0) return NextResponse.json({ error: 'No AI settings provided' }, { status: 400 })

  const prisma = getPrisma()
  for (const [key, value] of updates) {
    if (!SETTING_KEYS.includes(key as typeof SETTING_KEYS[number])) continue
    if (value === null || value.trim() === '') {
      await prisma.setting.delete({ where: { key } }).catch(() => null)
    } else {
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
    }
  }
  return GET()
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const target = data.target === 'embedding' ? 'embedding' : 'chat'
  const current = await effectiveSettings()
  const apiKey = stringValue(data.apiKey) || current.apiKey
  const embeddingApiKey = stringValue(data.embeddingApiKey) || current.embeddingApiKey

  try {
    if (target === 'embedding') {
      return await testEmbedding({
        baseUrl: normalizeBaseUrl(data.embeddingBaseUrl, true) || current.embeddingBaseUrl,
        model: stringValue(data.embeddingModel) || current.embeddingModel,
        apiKey: embeddingApiKey || apiKey,
      })
    }
    return await testChat({
      baseUrl: normalizeBaseUrl(data.baseUrl, true) || current.baseUrl,
      model: stringValue(data.model) || current.model,
      apiKey,
    })
  } catch (err) {
    if (err instanceof AiSettingsError) return NextResponse.json({ ok: false, error: err.message }, { status: 400 })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 })
  }
}

async function readSettings(): Promise<Record<string, string>> {
  const rows = await getPrisma().setting.findMany({ where: { key: { in: [...SETTING_KEYS] } } })
  return Object.fromEntries(rows.map(row => [row.key, row.value]))
}

async function effectiveSettings() {
  const values = await readSettings()
  const provider = normalizeProvider(values.llm_provider ?? process.env.LLM_PROVIDER ?? 'omlx')
  const defaults = providerDefaults(provider)
  const baseUrl = values.llm_base_url || envBaseUrl(provider) || defaults.defaultBaseUrl
  const model = values.llm_model || envModel(provider) || defaults.defaultModel
  const apiKey = values.llm_api_key || envApiKey(provider)
  const embeddingBaseUrl = values.embedding_base_url || process.env.EMBEDDING_BASE_URL || baseUrl
  const embeddingModel = values.embedding_model || process.env.EMBEDDING_MODEL || 'nomic-embed-text:v1.5'
  const embeddingApiKey = values.embedding_api_key || process.env.EMBEDDING_API_KEY || apiKey
  return { provider, baseUrl, model, apiKey, embeddingBaseUrl, embeddingModel, embeddingApiKey }
}

function normalizeProvider(value: string | null | undefined): AiProvider {
  const provider = normalizeAiProvider(value)
  return provider === 'custom' && !value ? 'omlx' : provider
}

function normalizeBaseUrl(value: unknown, required: boolean): string | null {
  const raw = stringValue(value)
  if (!raw) return required ? null : ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported protocol')
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new AiSettingsError('Endpoint must be a valid http(s) URL')
  }
}

function secretValue(value: unknown): string | null {
  if (value === null) return null
  return stringValue(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function timeoutValue(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(value ?? 30000)
  if (!Number.isFinite(raw)) return 30000
  return Math.min(300000, Math.max(5000, Math.round(raw)))
}

async function testChat(input: { baseUrl: string; model: string; apiKey: string }) {
  if (!input.model) return NextResponse.json({ ok: false, error: 'Chat model is required.' }, { status: 400 })
  const started = Date.now()
  const res = await fetch(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      temperature: 0,
      max_tokens: 8,
    }),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  if (!res.ok) {
    return NextResponse.json({ ok: false, status: res.status, ms: Date.now() - started, error: text.slice(0, 600) }, { status: 502 })
  }
  return NextResponse.json({ ok: true, status: res.status, ms: Date.now() - started })
}

async function testEmbedding(input: { baseUrl: string; model: string; apiKey: string }) {
  if (!input.model) return NextResponse.json({ ok: false, error: 'Embedding model is required.' }, { status: 400 })
  const started = Date.now()
  const res = await fetch(`${input.baseUrl}/embeddings`, {
    method: 'POST',
    headers: requestHeaders(input.apiKey),
    body: JSON.stringify({ model: input.model, input: 'Recall endpoint test' }),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  if (!res.ok) {
    return NextResponse.json({ ok: false, status: res.status, ms: Date.now() - started, error: text.slice(0, 600) }, { status: 502 })
  }
  return NextResponse.json({ ok: true, status: res.status, ms: Date.now() - started })
}

function requestHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'HTTP-Referer': 'https://recall.local',
    'X-Title': 'Recall',
  }
}

function envBaseUrl(provider: AiProvider): string {
  if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL
  if (provider === 'ollama') return process.env.OLLAMA_BASE_URL || ''
  if (provider === 'lmstudio') return process.env.LMSTUDIO_BASE_URL || ''
  if (provider === 'omlx') return process.env.OMLX_BASE_URL || ''
  if (provider === 'openrouter') return process.env.OPENROUTER_BASE_URL || ''
  return ''
}

function envModel(provider: AiProvider): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL
  if (provider === 'ollama') return process.env.OLLAMA_MODEL || ''
  if (provider === 'lmstudio') return process.env.LMSTUDIO_MODEL || ''
  if (provider === 'omlx') return process.env.OMLX_MODEL || ''
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || ''
  return ''
}

function envApiKey(provider: AiProvider): string {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY
  if (provider === 'omlx') return process.env.OMLX_API_KEY || ''
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY || ''
  return ''
}

class AiSettingsError extends Error {}
