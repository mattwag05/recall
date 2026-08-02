// The matching quiz posts one review per pair. There is no batch route and no
// undo route, so a mid-batch failure cannot be rolled back — the only honest
// behavior is to attempt every answer, report exactly how many landed, and let
// the caller retry just the ones that did not. This locks that behavior, and in
// particular that a partial batch is never reported as a clean run.
//
// Pure check script — no DB, no server, no AI. Safe for `npm test`.
import assert from 'node:assert/strict'
import { reviewOutcomeMessage, submitQuizReviews, type QuizReviewResult } from '../lib/quiz-review'

let passed = 0
let failed = 0

async function check(label: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL: ${label}\n  ${err instanceof Error ? err.message : String(err)}`)
  }
}

const ANSWERS: QuizReviewResult[] = [
  { questionId: 'q1', correct: true },
  { questionId: 'q2', correct: false },
  { questionId: 'q3', correct: true },
]

async function main() {
  await check('a clean batch records everything and reports the score', async () => {
    const seen: string[] = []
    const outcome = await submitQuizReviews(ANSWERS, async result => {
      seen.push(result.questionId)
      return { ok: true }
    })
    assert.deepEqual(seen.sort(), ['q1', 'q2', 'q3'])
    assert.equal(outcome.failed.length, 0)
    assert.equal(outcome.recorded.length, 3)
    assert.equal(reviewOutcomeMessage(outcome, 2), 'Matching quiz recorded: 2 of 3 correct')
  })

  await check('a failure mid-batch does not abandon the remaining answers', async () => {
    const seen: string[] = []
    const outcome = await submitQuizReviews(ANSWERS, async result => {
      seen.push(result.questionId)
      return result.questionId === 'q2' ? { ok: false, error: 'boom' } : { ok: true }
    })
    // The old serial loop stopped at q2 and left q3 unrecorded with no trace.
    assert.deepEqual(seen.sort(), ['q1', 'q2', 'q3'])
    assert.deepEqual(outcome.recorded.map(r => r.questionId).sort(), ['q1', 'q3'])
    assert.deepEqual(outcome.failed.map(r => r.questionId), ['q2'])
  })

  await check('a partial batch is never reported as a clean run', async () => {
    const outcome = await submitQuizReviews(ANSWERS, async result => (
      result.questionId === 'q2' ? { ok: false, error: 'server said no' } : { ok: true }
    ))
    const message = reviewOutcomeMessage(outcome, 2)
    assert.match(message, /Recorded 2 of 3/)
    assert.match(message, /1 did not save/)
    assert.match(message, /server said no/)
    assert.doesNotMatch(message, /correct$/)
  })

  await check('a thrown request counts as failed, not as recorded', async () => {
    const outcome = await submitQuizReviews(ANSWERS, async result => {
      if (result.questionId === 'q3') throw new Error('network down')
      return { ok: true }
    })
    assert.deepEqual(outcome.failed.map(r => r.questionId), ['q3'])
    assert.equal(outcome.error, 'network down')
  })

  await check('every answer fails cleanly when the route is down', async () => {
    const outcome = await submitQuizReviews(ANSWERS, async () => ({ ok: false, error: 'offline' }))
    assert.equal(outcome.recorded.length, 0)
    assert.equal(outcome.failed.length, 3)
    assert.match(reviewOutcomeMessage(outcome, 0), /Recorded 0 of 3/)
  })

  await check('retrying only the failed answers is enough to finish the batch', async () => {
    let firstPass = true
    const post = async (result: QuizReviewResult) => (
      firstPass && result.questionId === 'q2' ? { ok: false, error: 'boom' } : { ok: true }
    )
    const first = await submitQuizReviews(ANSWERS, post)
    firstPass = false
    const retry = await submitQuizReviews(first.failed, post)
    assert.equal(retry.failed.length, 0)
    assert.deepEqual(retry.recorded.map(r => r.questionId), ['q2'])
  })

  await check('an empty batch is a no-op', async () => {
    let calls = 0
    const outcome = await submitQuizReviews([], async () => { calls += 1; return { ok: true } })
    assert.equal(calls, 0)
    assert.equal(outcome.recorded.length, 0)
    assert.equal(outcome.failed.length, 0)
  })

  console.log(`\nQuiz batch review: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main()
