import { NextResponse } from 'next/server'
import { synthesizeSpeech, TtsError } from '@/lib/tts'
import { isAllowedVoice } from '@/lib/tts-preferences'

export const runtime = 'nodejs'

const SAMPLE_TEXT = 'This is how your Recall audio summaries will sound with this voice.'

// Synthesize a short fixed sample so Settings can preview a TTS voice.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const requestedVoice = body && typeof body === 'object' ? (body as { voice?: unknown }).voice : undefined
    const voice = isAllowedVoice(requestedVoice) ? requestedVoice : undefined

    const audio = await synthesizeSpeech(SAMPLE_TEXT, voice)
    return new NextResponse(audio, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if (err instanceof TtsError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: `Could not synthesize sample audio: ${String(err)}` }, { status: 500 })
  }
}
