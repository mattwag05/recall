import { NextResponse } from 'next/server'

/**
 * Log the real error server-side, return a generic message to the client.
 * Never interpolate the caught error into the response body.
 */
export function apiError(message: string, err: unknown, status = 500) {
  console.error(`[api] ${message}`, err)
  return NextResponse.json({ error: message }, { status })
}

/**
 * Like `apiError` but preserves `{ ok: false, error: message }` response shape.
 */
export function apiErrorOk(message: string, err: unknown, status = 500) {
  console.error(`[api] ${message}`, err)
  return NextResponse.json({ ok: false, error: message }, { status })
}
