import { NextResponse } from 'next/server'
import { ConnectionError, createManualCardConnection, deleteManualConnection } from '@/lib/connections'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const obj = (body ?? {}) as Record<string, unknown>
  const targetId = typeof obj.targetId === 'string' ? obj.targetId.trim() : null
  const targetTitle = typeof obj.targetTitle === 'string' ? obj.targetTitle.trim() : null
  const label = typeof obj.label === 'string' ? obj.label.trim() : null

  if (!targetId && !targetTitle) {
    return NextResponse.json({ error: 'Provide a target card or card title to link.' }, { status: 400 })
  }

  try {
    const connection = await createManualCardConnection({ fromId: id, targetId, targetTitle, label })
    return NextResponse.json({ ok: true, connection })
  } catch (err) {
    if (err instanceof ConnectionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Could not create card link: ${String(err)}` }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const connectionId = searchParams.get('connectionId')?.trim()
  if (!connectionId) {
    return NextResponse.json({ error: 'Missing connectionId.' }, { status: 400 })
  }

  try {
    const removed = await deleteManualConnection(id, connectionId)
    if (!removed) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ConnectionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Could not remove card link: ${String(err)}` }, { status: 500 })
  }
}
