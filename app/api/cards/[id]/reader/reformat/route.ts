import { NextResponse } from 'next/server'
import { llmChat } from '@/lib/ai-client'
import { getPrisma } from '@/lib/db'

export const runtime = 'nodejs'

const MAX_REFORMAT_INPUT_CHARS = 28000

type RouteParams = {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const card = await getPrisma().bookmark.findUnique({
      where: { id },
      select: { id: true, title: true, body: true, provider: true },
    })
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const readerText = card.body?.trim() ?? ''
    if (!readerText) return NextResponse.json({ error: 'Reader content is required before reformatting.' }, { status: 400 })

    const reformatted = await llmChat([{
      role: 'user',
      content: buildReaderReformatPrompt({
        title: card.title ?? 'Untitled',
        provider: card.provider,
        readerText: readerText.slice(0, MAX_REFORMAT_INPUT_CHARS),
        truncated: readerText.length > MAX_REFORMAT_INPUT_CHARS,
      }),
    }], {
      stage: 'reader_reformat',
      system: [
        'You reformat extracted reader text for Recall.',
        'Preserve meaning, source order, names, dates, numbers, quotes, and timestamps.',
        'Do not summarize, omit substantive details, add outside facts, add citations, or write meta commentary.',
        'Return only clean Markdown suitable for reading.',
      ].join(' '),
      temperature: 0.1,
      maxTokens: 2400,
    })

    const cleaned = reformatted.trim()
    if (!cleaned) return NextResponse.json({ error: 'The local model returned an empty Reader reformat.' }, { status: 503 })
    return NextResponse.json({
      ok: true,
      reformatted: cleaned,
      truncated: readerText.length > MAX_REFORMAT_INPUT_CHARS,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reformat Reader text: ${String(err)}` },
      { status: 503 },
    )
  }
}

function buildReaderReformatPrompt({
  title,
  provider,
  readerText,
  truncated,
}: {
  title: string
  provider: string | null
  readerText: string
  truncated: boolean
}): string {
  return [
    `Title: ${title}`,
    provider ? `Source: ${provider}` : null,
    truncated ? 'Note: the input was clipped to the first local processing window; preserve the supplied text only.' : null,
    'Task: Reformat the Reader text into readable Markdown with short sections, paragraphs, bullets, and preserved timestamps where useful. Do not summarize or invent content.',
    'Reader text:',
    readerText,
  ].filter((part): part is string => Boolean(part)).join('\n\n')
}
