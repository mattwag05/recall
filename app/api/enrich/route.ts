import { NextResponse } from 'next/server'
import { runPipeline } from '@/lib/pipeline'
import { apiErrorOk } from '@/lib/api-errors'
import { enabledStages } from '@/lib/app-preferences'
import { readPreferences } from '@/lib/app-preferences-store'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/enrich — run the AI pipeline over un-enriched cards (no vision for v1).
// Returns when done. Single-user, single local LLM, so it's gentle/serial.
//
// The stage list comes from the user's content preferences rather than being
// hardcoded, so turning off auto-tagging in Settings actually stops the tagging
// stage from spending tokens. `stages` is reported back so the caller can tell
// the user which stages ran instead of silently doing less than they expected.
export async function POST() {
  try {
    const prefs = await readPreferences()
    const stages = enabledStages(prefs)
    const result = await runPipeline({
      stages,
      batchSize: 10,
      notebookStyle: {
        depth: prefs.autoSummarize === 'detailed' ? 'detailed' : 'concise',
        language: prefs.aiLanguage,
      },
    })
    return NextResponse.json({ ok: true, stages, ...result })
  } catch (err) {
    return apiErrorOk('Enrichment failed', err, 500)
  }
}
