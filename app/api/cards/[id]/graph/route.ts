import { NextResponse } from 'next/server'
import { CardGraphError, getCardGraph } from '@/lib/connection-graph'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const depth = Number(searchParams.get('depth') ?? '2')

  try {
    const graph = await getCardGraph(id, depth)
    return NextResponse.json({ graph })
  } catch (err) {
    if (err instanceof CardGraphError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Could not load card graph: ${String(err)}` }, { status: 500 })
  }
}
