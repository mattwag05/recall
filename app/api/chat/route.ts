import { NextResponse } from 'next/server'
import { ChatRagError, getChatThread, runKnowledgeChat } from '@/lib/chat-rag'
import type { ChatAttachment } from '@/lib/recall-types'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const threadId = searchParams.get('threadId')?.trim()
  if (!threadId) return NextResponse.json({ error: 'threadId is required.' }, { status: 400 })

  const thread = await getChatThread(threadId)
  if (!thread) return NextResponse.json({ error: 'Chat thread not found' }, { status: 404 })
  return NextResponse.json({ thread })
}

export async function POST(request: Request) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    const prompt = typeof data.prompt === 'string' ? data.prompt : ''
    const scope = data.scope === 'card' || data.scope === 'tag' || data.scope === 'global' ? data.scope : 'global'
    const threadId = typeof data.threadId === 'string' ? data.threadId : null
    const includeSemantic = typeof data.includeSemantic === 'boolean' ? data.includeSemantic : true

    const result = await runKnowledgeChat({
      prompt,
      scope,
      cardIds: stringArray(data.cardIds),
      tagSlugs: stringArray(data.tagSlugs),
      threadId,
      includeSemantic,
      attachments: chatAttachments(data.attachments),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ChatRagError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: `Could not answer from local knowledge: ${String(err)}` },
      { status: 503 },
    )
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function chatAttachments(value: unknown): ChatAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ChatRagError('Chat attachments must be an array.', 400)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ChatRagError(`Attachment ${index + 1} is invalid.`, 400)
    const record = item as Record<string, unknown>
    return {
      name: typeof record.name === 'string' ? record.name : '',
      type: typeof record.type === 'string' ? record.type : null,
      text: typeof record.text === 'string' ? record.text : '',
      size: typeof record.size === 'number' ? record.size : null,
    }
  })
}
