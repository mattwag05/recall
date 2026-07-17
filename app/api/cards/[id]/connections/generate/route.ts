import { NextResponse } from 'next/server'
import { ConnectionError, generateEntityConnections } from '@/lib/connections'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params
  try {
    const result = await generateEntityConnections(id)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ConnectionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Could not generate entity links: ${String(err)}` }, { status: 500 })
  }
}
