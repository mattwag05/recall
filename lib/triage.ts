// Inbox triage state. Deliberately separate from Bookmark.status, which is the
// processing pipeline (organizing | summarizing | ready | failed) — a card can
// be finished processing and still be unreviewed, or reviewed while a re-enrich
// is running. Ported from Social Bookmarks Triage, where a single `status`
// column conflated the two.

export const TRIAGE_STATUSES = ['new', 'reviewed', 'pinned', 'archived'] as const

export type TriageStatus = (typeof TRIAGE_STATUSES)[number]

export function parseTriageStatus(value: unknown): TriageStatus | null {
  return typeof value === 'string' && (TRIAGE_STATUSES as readonly string[]).includes(value)
    ? (value as TriageStatus)
    : null
}

/**
 * What lands in the inbox. Cards mid-pipeline are excluded — they'd render
 * without a summary and can't be judged yet; they appear once processing
 * settles. Failed cards ARE included so they can be archived or opened and
 * retried rather than silently disappearing.
 */
export function inboxWhere() {
  return { triageStatus: 'new', status: { in: ['ready', 'failed'] } }
}
