import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api-errors'
import { SUPPORTED_LANGUAGES, type AppPreferences } from '@/lib/app-preferences'
import { readPreferences, writePreferences } from '@/lib/app-preferences-store'

export const runtime = 'nodejs'

// GET /api/settings/preferences — current content preferences plus the option
// lists, so the settings page does not have to keep its own copy in sync.
export async function GET() {
  try {
    return NextResponse.json({
      preferences: await readPreferences(),
      languages: SUPPORTED_LANGUAGES,
    })
  } catch (err) {
    return apiError('Failed to load preferences', err, 500)
  }
}

// PATCH /api/settings/preferences — partial update. Unknown values are coerced
// back to the defaults by writePreferences rather than rejected, matching how
// the rest of the settings surface behaves.
export async function PATCH(request: Request) {
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected an object' }, { status: 400 })
    }

    const patch = body as Partial<AppPreferences>
    return NextResponse.json({ preferences: await writePreferences(patch) })
  } catch (err) {
    return apiError('Failed to save preferences', err, 500)
  }
}
