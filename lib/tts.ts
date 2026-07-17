// Local TTS via Kokoro (OpenAI-compatible /v1/audio/speech). Audio summaries.
import { langCodeForVoice } from './tts-preferences'

const TTS_BASE = process.env.TTS_BASE_URL || 'http://127.0.0.1:8880/v1'
const TTS_MODEL = process.env.TTS_MODEL || 'kokoro'
const TTS_VOICE = process.env.TTS_VOICE || 'af_heart'

// Kokoro is reliable up to a few thousand chars; keep summaries short so synth
// stays fast and the audio is a digestible recap, not the whole article.
const MAX_TTS_CHARS = 2000

export class TtsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Strip markdown to plain spoken text (headings, links, emphasis, lists). */
export function spokenText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')        // code fences
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')  // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/\[\[([^\]]+)\]\]/g, '$1')      // wikilinks
    .replace(/^#{1,6}\s+/gm, '')            // headings
    .replace(/^\s*[-*+]\s+/gm, '')          // bullets
    .replace(/[*_~>]/g, '')                 // emphasis/blockquote marks
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TTS_CHARS)
}

/** Pick the best card text for an audio summary: summary > notebook > body. */
export function summaryForSpeech(card: {
  title?: string | null
  summary?: string | null
  notebookContent?: string | null
  body?: string | null
}): string {
  const title = (card.title || '').trim()
  const candidates = [card.summary, card.notebookContent, card.body]
  for (const candidate of candidates) {
    const text = spokenText(candidate || '')
    if (text) return title ? `${title}. ${text}` : text
  }
  return title
}

/** Synthesize MP3 audio for the given text. Throws TtsError on bad input/offline. */
export async function synthesizeSpeech(text: string, voice?: string): Promise<ArrayBuffer> {
  const spoken = spokenText(text)
  if (!spoken) throw new TtsError('No readable text to read aloud.', 400)

  const useVoice = voice || TTS_VOICE
  let res: Response
  try {
    res = await fetch(`${TTS_BASE}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // lang_code (voice's first letter) keeps pronunciation correct per language.
      body: JSON.stringify({ model: TTS_MODEL, input: spoken, voice: useVoice, lang_code: langCodeForVoice(useVoice), response_format: 'mp3' }),
    })
  } catch (err) {
    throw new TtsError(`Local TTS service is unavailable: ${String(err)}`, 503)
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new TtsError(`Local TTS service returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, 503)
  }
  return res.arrayBuffer()
}

export const __ttsTest = { spokenText, summaryForSpeech }
