import { getPrisma } from './db'

export type DailyBucket = { date: string; count: number }

export type ReviewActivity = {
  currentStreak: number
  longestStreak: number
  totalReviews: number
  reviewsToday: number
  daily: DailyBucket[]
}

// ponytail: day boundaries use the server's local timezone. Fine for a
// single-user local app; if multi-user/multi-tz ever lands, store a tz per user.
export function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Compute streaks + daily activity from raw review timestamps.
 * `today` anchors the calendar; `days` is the size of the activity window.
 * A current streak stays alive on a day with no reviews yet (counts back from
 * yesterday) so an in-progress day doesn't read as a broken streak.
 */
export function computeActivity(timestamps: Date[], today: Date, days = 30): ReviewActivity {
  const counts = new Map<string, number>()
  for (const ts of timestamps) {
    const key = dayKey(ts)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const todayKey = dayKey(today)
  const reviewsToday = counts.get(todayKey) ?? 0

  // Current streak: walk back from today (or yesterday if today is empty).
  let currentStreak = 0
  let cursor = reviewsToday > 0 ? new Date(today) : addDays(today, -1)
  while (counts.has(dayKey(cursor))) {
    currentStreak += 1
    cursor = addDays(cursor, -1)
  }

  // Longest streak: scan sorted active days for the longest consecutive run.
  const activeDays = [...counts.keys()].sort()
  let longestStreak = 0
  let run = 0
  let prev: string | null = null
  for (const key of activeDays) {
    if (prev && dayKey(addDays(new Date(`${prev}T00:00:00`), 1)) === key) {
      run += 1
    } else {
      run = 1
    }
    longestStreak = Math.max(longestStreak, run)
    prev = key
  }

  // Daily buckets, oldest -> newest, for the activity strip.
  const daily: DailyBucket[] = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(addDays(today, -i))
    daily.push({ date: key, count: counts.get(key) ?? 0 })
  }

  const totalReviews = timestamps.length

  return { currentStreak, longestStreak, totalReviews, reviewsToday, daily }
}

/** Load review activity from the DB (last 365 days of events drives streaks). */
export async function getReviewActivity(days = 30): Promise<ReviewActivity> {
  const prisma = getPrisma()
  const now = new Date()
  const yearAgo = addDays(now, -365)
  const [logs, totalReviews] = await Promise.all([
    prisma.reviewLog.findMany({
      where: { reviewedAt: { gte: yearAgo } },
      select: { reviewedAt: true },
    }),
    prisma.reviewLog.count(),
  ])
  const activity = computeActivity(logs.map(l => l.reviewedAt), now, days)
  return { ...activity, totalReviews }
}

export const __reviewActivityTest = { computeActivity, dayKey }
