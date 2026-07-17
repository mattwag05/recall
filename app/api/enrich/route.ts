import { NextResponse } from 'next/server'
import { runPipeline } from '@/lib/pipeline'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/enrich — run the AI pipeline over un-enriched cards (no vision for v1).
// Returns when done. Single-user, single local LLM, so it's gentle/serial.
export async function POST() {
  try {
    const result = await runPipeline({
      stages: ['entity_extraction', 'semantic_tagging', 'categorization', 'summarization', 'connection_generation', 'embedding'],
      batchSize: 10,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
