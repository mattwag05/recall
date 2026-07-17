import assert from 'node:assert/strict'
import { __reviewActivityTest } from '../lib/review-activity'

const { computeActivity } = __reviewActivityTest

function at(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00`)
}

const today = at('2026-06-22')

// Empty history.
const empty = computeActivity([], today, 7)
assert.equal(empty.currentStreak, 0)
assert.equal(empty.longestStreak, 0)
assert.equal(empty.totalReviews, 0)
assert.equal(empty.reviewsToday, 0)
assert.equal(empty.daily.length, 7)
assert.equal(empty.daily[6].date, '2026-06-22')

// Reviewed today + previous two days -> streak of 3.
const threeDay = computeActivity(
  [at('2026-06-22'), at('2026-06-22'), at('2026-06-21'), at('2026-06-20')],
  today,
  30,
)
assert.equal(threeDay.currentStreak, 3)
assert.equal(threeDay.longestStreak, 3)
assert.equal(threeDay.reviewsToday, 2)
assert.equal(threeDay.totalReviews, 4)
assert.equal(threeDay.daily.at(-1)?.count, 2)

// No review today but reviewed yesterday + day before -> streak stays alive at 2.
const aliveYesterday = computeActivity([at('2026-06-21'), at('2026-06-20')], today, 30)
assert.equal(aliveYesterday.currentStreak, 2)
assert.equal(aliveYesterday.reviewsToday, 0)

// Gap breaks the current streak but longest reflects the older run.
const withGap = computeActivity(
  [at('2026-06-22'), at('2026-06-18'), at('2026-06-17'), at('2026-06-16')],
  today,
  30,
)
assert.equal(withGap.currentStreak, 1)
assert.equal(withGap.longestStreak, 3)

console.log('review activity checks passed')
