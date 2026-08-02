import { NextResponse } from 'next/server'
import { getKnowledgeGraph, MAX_GRAPH_NODES } from '@/lib/knowledge-graph'
import { apiError } from '@/lib/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const requested = Number(searchParams.get('limit'))
  const maxNodes = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.round(requested), MAX_GRAPH_NODES)
    : MAX_GRAPH_NODES

  try {
    const graph = await getKnowledgeGraph(maxNodes)
    return NextResponse.json({ graph })
  } catch (err) {
    return apiError('Could not load the knowledge graph', err, 500)
  }
}
