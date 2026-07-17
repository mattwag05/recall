import { llmVision } from './ai-client'

export const MAX_CHAT_IMAGE_BYTES = 1024 * 1024
export const MAX_CHAT_IMAGE_CHARS = 12000
export const MAX_IMPORT_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_IMAGE_CHARS = 24000

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export class ImageVisionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function chatImageMimeType(type: string, filename: string): string | null {
  const normalized = type.toLowerCase()
  if (SUPPORTED_IMAGE_TYPES.has(normalized)) return normalized
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[extension] ?? null
}

export const savedImageMimeType = chatImageMimeType

export async function extractImageTextForChat(
  data: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<{ text: string; truncated: boolean }> {
  return extractImageText(data, filename, mimeType, {
    maxBytes: MAX_CHAT_IMAGE_BYTES,
    maxChars: MAX_CHAT_IMAGE_CHARS,
    system: imageVisionSystemPrompt('temporary chat context'),
    prompt: imageVisionPrompt(filename, 'temporary chat context'),
    emptyMessage: `${filename.trim() || 'image'} did not produce readable OCR/vision text.`,
  })
}

export async function extractImageTextForImport(
  data: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<{ text: string; tags: string[]; truncated: boolean }> {
  const extracted = await extractImageText(data, filename, mimeType, {
    maxBytes: MAX_IMPORT_IMAGE_BYTES,
    maxChars: MAX_IMPORT_IMAGE_CHARS,
    system: imageVisionSystemPrompt('saved Recall card content'),
    prompt: imageVisionPrompt(filename, 'saved Recall card content'),
    emptyMessage: `${filename.trim() || 'image'} did not produce readable OCR/vision text.`,
  })
  return {
    ...extracted,
    tags: parseVisionTags(extracted.text),
  }
}

async function extractImageText(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  options: {
    maxBytes: number
    maxChars: number
    system: string
    prompt: string
    emptyMessage: string
  },
): Promise<{ text: string; truncated: boolean }> {
  const name = filename.trim() || 'image'
  if (data.byteLength === 0) throw new ImageVisionError(`${name} is empty.`, 400)
  if (data.byteLength > options.maxBytes) throw new ImageVisionError(`${name} is larger than ${formatBytes(options.maxBytes)}.`, 400)
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new ImageVisionError(`${name} must be a PNG, JPG, or WebP image for OCR/vision.`, 400)
  }

  let result: string
  try {
    result = await llmVision(options.prompt, { data, mimeType }, {
      stage: 'vision',
      system: options.system,
      temperature: 0.1,
      maxTokens: 900,
    })
  } catch (err) {
    throw new ImageVisionError(
      `Image OCR/vision is unavailable from the local model: ${String(err)}`,
      503,
    )
  }

  const normalized = normalizeVisionText(result)
  if (!normalized) {
    throw new ImageVisionError(options.emptyMessage, 422)
  }
  const text = normalized.slice(0, options.maxChars)
  return { text, truncated: normalized.length > text.length }
}

function imageVisionSystemPrompt(destination: string): string {
  return [
    'You are Recall, a local image OCR and vision extractor.',
    'Describe only what is visible in the uploaded image.',
    'Transcribe visible text as accurately as possible.',
    'Do not identify private people, infer sensitive traits, or invent unseen details.',
    `Return concise Markdown suitable as ${destination}.`,
  ].join(' ')
}

function imageVisionPrompt(filename: string, destination: string): string {
  return [
    `Extract ${destination} from ${filename}.`,
    'Use this exact structure:',
    '## Visible text',
    'Transcribe any visible text. If none is visible, write "None visible."',
    '## Visual description',
    'Briefly describe the image, layout, objects, charts, screenshots, or document structure.',
    '## Useful details',
    'List concrete details that would help answer questions about this image.',
    '## Tags',
    'List 3-8 short lowercase topic tags, one per line, prefixed with "- ".',
  ].join('\n')
}

function normalizeVisionText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseVisionTags(value: string): string[] {
  const marker = value.match(/##\s*Tags\s*\n([\s\S]*)/i)
  if (!marker) return []
  return [...new Set(marker[1]
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim().toLowerCase())
    .filter(tag => /^[a-z0-9][a-z0-9 -]{1,40}$/.test(tag))
    .slice(0, 8))]
}

function formatBytes(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MB`
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`
  return `${bytes} B`
}
