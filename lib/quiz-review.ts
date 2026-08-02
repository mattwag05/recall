// Batch review submission for the matching quiz.
//
// The old version posted each answer in a serial for-loop and bailed on the
// first failure, leaving some answers recorded and some not while telling the
// user the whole thing failed. There is no server-side batch review route and no
// undo route, so this cannot be a transaction; instead every answer is attempted
// and the caller is handed back exactly which ones did not land, so it can say
// so and retry only those.

export interface QuizReviewResult {
  questionId: string
  correct: boolean
}

export interface QuizReviewOutcome {
  recorded: QuizReviewResult[]
  failed: QuizReviewResult[]
  /** First error message seen, for the toast. */
  error: string | null
}

export type ReviewPoster = (result: QuizReviewResult) => Promise<{ ok: boolean; error?: string }>

export async function submitQuizReviews(
  results: QuizReviewResult[],
  post: ReviewPoster,
): Promise<QuizReviewOutcome> {
  const settled = await Promise.all(results.map(async result => {
    try {
      const response = await post(result)
      return { result, ok: response.ok === true, error: response.error }
    } catch (err) {
      return { result, ok: false, error: err instanceof Error ? err.message : undefined }
    }
  }))

  return {
    recorded: settled.filter(item => item.ok).map(item => item.result),
    failed: settled.filter(item => !item.ok).map(item => item.result),
    error: settled.find(item => !item.ok && item.error)?.error ?? null,
  }
}

/** Honest message: never claims a clean run when part of the batch did not land. */
export function reviewOutcomeMessage(outcome: QuizReviewOutcome, correctCount: number): string {
  const total = outcome.recorded.length + outcome.failed.length
  if (outcome.failed.length === 0) {
    return `Matching quiz recorded: ${correctCount} of ${total} correct`
  }
  const detail = outcome.error ? ` (${outcome.error})` : ''
  return `Recorded ${outcome.recorded.length} of ${total} answers — ${outcome.failed.length} did not save${detail}. Retry the unsaved answers.`
}
