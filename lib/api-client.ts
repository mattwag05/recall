// Client-side helpers for reading errors back out of Recall's own API routes.
// Each of these existed in 4-6 near-identical copies across the components.

/** Pull `{ error }` off a parsed JSON body, else the fallback. */
export function apiError(data: unknown, fallback: string): string {
  if (data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error
  }
  return fallback
}

/** Same, but reads and parses the response first. Never throws. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  return apiError(await res.json().catch(() => null), fallback)
}

/** Message off a thrown value, else the fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
