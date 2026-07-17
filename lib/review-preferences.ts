export type ReviewSessionSize = 5 | 10 | 20 | 'all'
export type DailyReviewGoal = 5 | 10 | 20 | 30

export type ReviewPreferences = {
  dailyGoal: DailyReviewGoal
  sessionSize: ReviewSessionSize
}

export const REVIEW_PREFERENCES_KEY = 'recall:review-preferences:v1'

export const DAILY_REVIEW_GOALS: { id: DailyReviewGoal; label: string }[] = [
  { id: 5, label: '5' },
  { id: 10, label: '10' },
  { id: 20, label: '20' },
  { id: 30, label: '30' },
]

export const REVIEW_SESSION_SIZES: { id: ReviewSessionSize; label: string }[] = [
  { id: 5, label: '5' },
  { id: 10, label: '10' },
  { id: 20, label: '20' },
  { id: 'all', label: 'All' },
]

export const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = {
  dailyGoal: 10,
  sessionSize: 10,
}

export function readReviewPreferences(): ReviewPreferences {
  if (typeof window === 'undefined') return DEFAULT_REVIEW_PREFERENCES
  try {
    return parseReviewPreferences(localStorage.getItem(REVIEW_PREFERENCES_KEY))
  } catch {
    return DEFAULT_REVIEW_PREFERENCES
  }
}

export function writeReviewPreferences(preferences: ReviewPreferences) {
  try {
    localStorage.setItem(REVIEW_PREFERENCES_KEY, JSON.stringify(normalizeReviewPreferences(preferences)))
  } catch {}
}

export function resolveReviewSessionSize(size: ReviewSessionSize, available: number): number {
  if (size === 'all') return available
  return Math.min(size, available)
}

function parseReviewPreferences(raw: string | null): ReviewPreferences {
  if (!raw) return DEFAULT_REVIEW_PREFERENCES
  try {
    const parsed = JSON.parse(raw)
    return normalizeReviewPreferences(parsed)
  } catch {
    return DEFAULT_REVIEW_PREFERENCES
  }
}

function normalizeReviewPreferences(value: unknown): ReviewPreferences {
  const input = value && typeof value === 'object' ? value as Partial<ReviewPreferences> : {}
  const dailyGoal = DAILY_REVIEW_GOALS.some(option => option.id === input.dailyGoal)
    ? input.dailyGoal as DailyReviewGoal
    : DEFAULT_REVIEW_PREFERENCES.dailyGoal
  const sessionSize = REVIEW_SESSION_SIZES.some(option => option.id === input.sessionSize)
    ? input.sessionSize as ReviewSessionSize
    : DEFAULT_REVIEW_PREFERENCES.sessionSize

  return { dailyGoal, sessionSize }
}
