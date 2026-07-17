import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { summaryForSpeech, synthesizeSpeech, TtsError } from '@/lib/tts'
import { isAllowedVoice } from '@/lib/tts-preferences'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

// Synthesize a spoken audio summary for a card via the local Kokoro TTS service.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => null)
    const requestedVoice = body && typeof body === 'object' ? (body as { voice?: unknown }).voice : undefined
    const voice = isAllowedVoice(requestedVoice) ? requestedVoice : undefined

    const card = await getPrisma().bookmark.findUnique({
      where: { id },
      select: { id: true, title: true, summary: true, notebookContent: true, body: true },
    })
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const text = summaryForSpeech(card)
    const audio = await synthesizeSpeech(text, voice)
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof TtsError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Could not synthesize audio: ${String(err)}` }, { status: 500 })
  }
}
