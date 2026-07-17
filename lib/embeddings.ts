import OpenAI from 'openai'
import { getDb, getPrisma } from './db'
import { getRuntimeLlmSettings } from './ai-client'

const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1'
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || 'ollama'
const DEFAULT_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text:v1.5'
const MAX_EMBEDDING_TEXT_CHARS = 12000

let embeddingClient: { key: string; client: OpenAI } | undefined

export interface EmbeddingBookmarkInput {
  id: string
  title?: string | null
  text?: string | null
  body?: string | null
  summary?: string | null
  notebookContent?: string | null
  semanticTags?: string | null
  categories?: string[] | null
}

export async function getEmbeddingModel(): Promise<string> {
  try {
    const setting = await getPrisma().setting.findUnique({ where: { key: 'model_embedding' } })
    if (setting?.value) return setting.value
    const aiSetting = await getPrisma().setting.findUnique({ where: { key: 'embedding_model' } })
    if (aiSetting?.value) return aiSetting.value
  } catch {}
  return DEFAULT_EMBEDDING_MODEL
}

export async function embedText(text: string): Promise<number[]> {
  const input = text.trim().slice(0, MAX_EMBEDDING_TEXT_CHARS)
  if (!input) throw new Error('Cannot embed empty text.')
  const model = await getEmbeddingModel()
  let baseUrl = EMBEDDING_BASE_URL
  try {
    const runtime = await getRuntimeEmbeddingSettings()
    baseUrl = runtime.baseUrl
    const client = runtime.client
    const response = await client.embeddings.create({ model, input })
    const embedding = response.data[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding provider returned no vector.')
    }
    return embedding.filter(Number.isFinite)
  } catch (err) {
    throw new Error(
      `Could not generate local embedding with ${model} at ${baseUrl}: ${String(err)}. ` +
      'Confirm the configured embedding endpoint is running and the model is installed.',
    )
  }
}

export async function embedBookmark(input: EmbeddingBookmarkInput): Promise<Uint8Array<ArrayBuffer> | null> {
  const text = embeddingTextForBookmark(input)
  if (!text) return null
  return serializeEmbedding(await embedText(text))
}

export function storeBookmarkEmbedding(bookmarkId: string, embedding: Uint8Array): void {
  getDb().prepare('UPDATE Bookmark SET embedding = ? WHERE id = ?').run(Buffer.from(embedding), bookmarkId)
}

export function clearBookmarkEmbedding(bookmarkId: string): void {
  getDb().prepare('UPDATE Bookmark SET embedding = NULL WHERE id = ?').run(bookmarkId)
}

export function embeddingTextForBookmark(input: EmbeddingBookmarkInput): string {
  const semanticTags = parseStringArray(input.semanticTags)
  const chunks = [
    input.title,
    input.summary,
    input.notebookContent,
    input.body,
    input.text,
    semanticTags.length > 0 ? `Tags: ${semanticTags.join(', ')}` : null,
    input.categories && input.categories.length > 0 ? `Categories: ${input.categories.join(', ')}` : null,
  ]
  return chunks
    .map(chunk => chunk?.trim())
    .filter((chunk): chunk is string => Boolean(chunk))
    .join('\n\n')
    .slice(0, MAX_EMBEDDING_TEXT_CHARS)
}

export function serializeEmbedding(values: number[]): Uint8Array<ArrayBuffer> {
  const normalized = values.filter(Number.isFinite)
  const floats = new Float32Array(normalized.length)
  floats.set(normalized)
  return new Uint8Array(floats.buffer.slice(0))
}

export function deserializeEmbedding(value: Uint8Array | null | undefined): number[] | null {
  if (!value || value.byteLength === 0 || value.byteLength % 4 !== 0) return null
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  const result: number[] = []
  for (let offset = 0; offset < value.byteLength; offset += 4) {
    const next = view.getFloat32(offset, true)
    if (!Number.isFinite(next)) return null
    result.push(next)
  }
  return result
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return Number.NEGATIVE_INFINITY
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return Number.NEGATIVE_INFINITY
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function getRuntimeEmbeddingSettings(): Promise<{ client: OpenAI; baseUrl: string }> {
  let baseUrl = EMBEDDING_BASE_URL
  let apiKey = EMBEDDING_API_KEY
  try {
    const prisma = getPrisma()
    const [baseSetting, keySetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'embedding_base_url' } }),
      prisma.setting.findUnique({ where: { key: 'embedding_api_key' } }),
    ])
    const llm = await getRuntimeLlmSettings()
    baseUrl = baseSetting?.value || process.env.EMBEDDING_BASE_URL || llm.baseUrl
    apiKey = keySetting?.value || process.env.EMBEDDING_API_KEY || llm.apiKey || EMBEDDING_API_KEY
  } catch {}
  const cacheKey = `${baseUrl}|${apiKey}`
  if (embeddingClient?.key === cacheKey) return { client: embeddingClient.client, baseUrl }
  const client = new OpenAI({ baseURL: baseUrl, apiKey })
  embeddingClient = { key: cacheKey, client }
  return { client, baseUrl }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
