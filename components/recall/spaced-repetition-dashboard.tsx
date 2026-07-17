'use client'

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DEFAULT_REVIEW_PREFERENCES, readReviewPreferences, resolveReviewSessionSize, type ReviewPreferences } from '@/lib/review-preferences'
import type { ReviewActivity } from '@/lib/review-activity'

type ReviewTab = 'review' | 'questions'

const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'questions', label: 'Questions' },
]

type ReviewMetrics = {
  dueQuestions: number
  dueThisWeek: number
  dueNextWeek: number
}

type ReviewStats = {
  answered: number
  correct: number
  accuracy: number
  reviewedLast30: number
  totalQuestions: number
}

type MemoryStageSummary = {
  stage: string
  count: number
}

export type QuestionGroup = {
  cardId: string
  title: string
  count: number
  due: number
  reviewed: number
}

export type ReviewQuestion = {
  id: string
  cardId: string
  cardTitle: string
  prompt: string
  answer: string
  type: string
  options?: string[]
  origin: string
  memoryStage: string
  dueAt: string | null
  timesSeen: number
  timesCorrect: number
}

export function SpacedRepetitionDashboard({
  metrics,
  stats,
  memoryStages,
  questionGroups,
  reviewQueue,
  activity,
}: {
  metrics: ReviewMetrics
  stats: ReviewStats
  memoryStages: MemoryStageSummary[]
  questionGroups: QuestionGroup[]
  reviewQueue: ReviewQuestion[]
  activity: ReviewActivity
}) {
  const [tab, setTab] = useState<ReviewTab>('review')
  const [reviewPreferences, setReviewPreferences] = useState<ReviewPreferences>(DEFAULT_REVIEW_PREFERENCES)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReviewPreferences(readReviewPreferences())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  function focusTab(next: ReviewTab) {
    setTab(next)
    window.setTimeout(() => document.getElementById(reviewTabId(next))?.focus(), 0)
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: ReviewTab) {
    const currentIndex = REVIEW_TABS.findIndex(item => item.id === current)
    if (currentIndex < 0) return

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusTab(REVIEW_TABS[(currentIndex + 1) % REVIEW_TABS.length].id)
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusTab(REVIEW_TABS[(currentIndex - 1 + REVIEW_TABS.length) % REVIEW_TABS.length].id)
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusTab(REVIEW_TABS[0].id)
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusTab(REVIEW_TABS[REVIEW_TABS.length - 1].id)
    }
  }

  return (
    <>
      <div className="flex gap-4 pt-4 rr-rule" role="tablist" aria-label="Review sections">
        {REVIEW_TABS.map(item => (
          <button
            key={item.id}
            id={reviewTabId(item.id)}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={reviewPanelId(item.id)}
            tabIndex={tab === item.id ? 0 : -1}
            className="rr-mono pb-2"
            onClick={() => setTab(item.id)}
            onKeyDown={e => onTabKeyDown(e, item.id)}
            style={{
              color: tab === item.id ? 'var(--accent)' : 'var(--sepia)',
              borderBottom: tab === item.id ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id={reviewPanelId(tab)} role="tabpanel" aria-labelledby={reviewTabId(tab)}>
        {tab === 'review' ? (
          <ReviewPanel metrics={metrics} stats={stats} memoryStages={memoryStages} reviewQueue={reviewQueue} reviewPreferences={reviewPreferences} activity={activity} />
        ) : (
          <QuestionsPanel totalQuestions={stats.totalQuestions} questionGroups={questionGroups} />
        )}
      </div>
    </>
  )
}

function ReviewPanel({
  metrics,
  stats,
  memoryStages,
  reviewQueue,
  reviewPreferences,
  activity,
}: {
  metrics: ReviewMetrics
  stats: ReviewStats
  memoryStages: MemoryStageSummary[]
  reviewQueue: ReviewQuestion[]
  reviewPreferences: ReviewPreferences
  activity: ReviewActivity
}) {
  const router = useRouter()
  const [queue, setQueue] = useState(reviewQueue)
  const [reviewing, setReviewing] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [answerRevealed, setAnswerRevealed] = useState(false)
  const [draftAnswer, setDraftAnswer] = useState('')
  const [selectedOption, setSelectedOption] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewedThisSession, setReviewedThisSession] = useState(0)
  const [sessionCompleteMessage, setSessionCompleteMessage] = useState<string | null>(null)
  const activeQuestion = queue[0] ?? null
  const dueCount = reviewQueue.length
  const sessionLimit = resolveReviewSessionSize(reviewPreferences.sessionSize, dueCount)
  const sessionLimitLabel = reviewPreferences.sessionSize === 'all' ? 'All due' : `${reviewPreferences.sessionSize}`
  const activeOptions = questionOptions(activeQuestion)
  const activeIsMcq = activeOptions.length > 0

  useEffect(() => {
    if (!sessionActive) setQueue(reviewQueue)
  }, [reviewQueue, sessionActive])

  function startReview() {
    if (dueCount === 0) return
    setQueue(reviewQueue.slice(0, sessionLimit))
    setSessionActive(true)
    setAnswerRevealed(false)
    setDraftAnswer('')
    setSelectedOption('')
    setReviewError(null)
    setReviewedThisSession(0)
    setSessionCompleteMessage(null)
  }

  function endReview() {
    setSessionActive(false)
    setAnswerRevealed(false)
    setDraftAnswer('')
    setSelectedOption('')
    setReviewError(null)
    setSessionCompleteMessage(null)
    router.refresh()
  }

  async function recordAnswer(correct: boolean) {
    if (!activeQuestion || reviewing) return
    setReviewing(true)
    setReviewError(null)
    try {
      const res = await fetch(`/api/cards/${activeQuestion.cardId}/questions/${activeQuestion.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !isReviewResponse(data)) {
        throw new Error(apiError(data, res.ok ? 'The local review API returned an unexpected response' : 'Could not record review answer'))
      }
      const remaining = queue.slice(1)
      const nextReviewed = reviewedThisSession + 1
      setQueue(remaining)
      setReviewedThisSession(nextReviewed)
      setAnswerRevealed(false)
      setDraftAnswer('')
      setSelectedOption('')
      if (remaining.length === 0) {
        setSessionActive(false)
        setSessionCompleteMessage(
          sessionLimit < dueCount
            ? `Review session complete. ${nextReviewed} ${nextReviewed === 1 ? 'question' : 'questions'} reviewed; ${dueCount - nextReviewed} due questions remain for another session.`
            : `Review queue complete. ${nextReviewed} ${nextReviewed === 1 ? 'question' : 'questions'} reviewed this session.`,
        )
      }
      router.refresh()
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Could not record review answer')
    } finally {
      setReviewing(false)
    }
  }

  return (
    <>
      <section className="grid gap-3 py-6 rr-rule sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Ready for review" value={metrics.dueQuestions} />
        <Metric label="Due this week" value={metrics.dueThisWeek} />
        <Metric label="Due next week" value={metrics.dueNextWeek} />
        <Metric label="Daily goal" value={reviewPreferences.dailyGoal} />
      </section>

      <section className="grid gap-5 py-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rr-card px-5 py-4" style={{ borderRadius: 3 }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 500 }}>Review dashboard</h2>
              <p className="rr-prose mt-1" style={{ fontSize: '0.95rem' }}>
                Review due short-answer and multiple-choice questions across your local Recall library.
              </p>
            </div>
            <button
              className="rr-btn rr-btn-accent"
              disabled={dueCount === 0 || reviewing}
              aria-label="Start spaced repetition review"
              title={dueCount > 0 ? `Start a local review session with up to ${sessionLimitLabel.toLowerCase()} questions.` : 'No due questions are ready for review.'}
              onClick={startReview}
              type="button"
            >
              Start review
            </button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat label="Answered" value={stats.answered} />
            <MiniStat label="Correct" value={stats.correct} />
            <MiniStat label="Accuracy" value={`${stats.accuracy}%`} />
            <MiniStat label="Session limit" value={sessionLimitLabel} />
          </div>
          {sessionActive && activeQuestion && (
            <section className="mt-5 space-y-4 rr-rule pt-4" aria-label="Spaced repetition review session">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="rr-mono">Due queue · {queue.length} remaining</div>
                  <h3 className="font-display mt-2" style={{ fontSize: '1.1rem', fontWeight: 500, overflowWrap: 'anywhere' }}>{activeQuestion.prompt}</h3>
                  <Link href={`/item/${activeQuestion.cardId}?tab=quiz`} className="rr-link rr-mono mt-2 inline-block">
                    {activeQuestion.cardTitle}
                  </Link>
                </div>
                <button className="rr-btn" type="button" onClick={endReview} disabled={reviewing}>End review</button>
              </div>
              {activeIsMcq ? (
                <fieldset className="space-y-2" disabled={reviewing || answerRevealed}>
                  <legend className="rr-mono">Choose an answer</legend>
                  {activeOptions.map(option => (
                    <label key={option} className="rr-card flex cursor-pointer items-start gap-3 p-3" style={{ borderRadius: 3 }}>
                      <input
                        type="radio"
                        name={`review-option-${activeQuestion.id}`}
                        value={option}
                        checked={selectedOption === option}
                        onChange={() => setSelectedOption(option)}
                        className="mt-1"
                      />
                      <span className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{option}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <label className="block">
                  <span className="rr-mono">Your answer</span>
                  <textarea
                    value={draftAnswer}
                    onChange={event => setDraftAnswer(event.target.value)}
                    aria-label="Review answer"
                    className="mt-2 min-h-24 w-full resize-y bg-transparent p-3 outline-none rr-rule rr-prose"
                    disabled={reviewing || answerRevealed}
                  />
                </label>
              )}
              {!answerRevealed ? (
                <button className="rr-btn rr-btn-accent" type="button" onClick={() => setAnswerRevealed(true)} disabled={reviewing}>Reveal answer</button>
              ) : (
                <div className="space-y-3">
                  <div className="rr-rule p-3">
                    <div className="rr-mono mb-1">Expected answer</div>
                    <p className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{activeQuestion.answer}</p>
                  </div>
                  {draftAnswer.trim() && (
                    <div className="rr-rule p-3">
                      <div className="rr-mono mb-1">Your answer</div>
                      <p className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{draftAnswer}</p>
                    </div>
                  )}
                  {activeIsMcq && selectedOption && (
                    <div className="rr-rule p-3">
                      <div className="rr-mono mb-1">Your choice</div>
                      <p className="rr-prose" style={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{selectedOption}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button className="rr-btn rr-btn-accent" type="button" disabled={reviewing || activeIsMcq && !selectedOption} onClick={() => void recordAnswer(activeIsMcq ? normalizeAnswer(selectedOption) === normalizeAnswer(activeQuestion.answer) : true)}>{activeIsMcq ? 'Submit choice' : 'Mark correct'}</button>
                    {!activeIsMcq && <button className="rr-btn" type="button" disabled={reviewing} onClick={() => void recordAnswer(false)}>Practice again</button>}
                  </div>
                </div>
              )}
              {reviewError && <p className="rr-prose" style={{ fontSize: '0.92rem', color: 'var(--accent)' }}>{reviewError}</p>}
            </section>
          )}
          {!sessionActive && sessionCompleteMessage && (
            <p className="rr-prose mt-5" style={{ fontSize: '0.94rem' }}>{sessionCompleteMessage}</p>
          )}
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="rr-mono">Activity</div>
              {activity.totalReviews > 0 && (
                <span className="rr-mono" style={{ color: 'var(--sepia)' }}>{activity.totalReviews} total reviews</span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StreakStat label="Current streak" value={activity.currentStreak} highlight={activity.reviewsToday > 0} />
              <StreakStat label="Longest streak" value={activity.longestStreak} />
              <StreakStat label="Reviewed today" value={activity.reviewsToday} />
            </div>
            {activity.totalReviews > 0 ? (
              <ActivityStrip daily={activity.daily} />
            ) : (
              <NoData className="mt-3">{dueCount > 0 ? 'Start review to begin your streak — answered questions build daily activity here.' : 'No review activity yet. Generate or create quiz questions from a card to build the due queue.'}</NoData>
            )}
          </div>
        </div>

        <div className="rr-card px-5 py-4" style={{ borderRadius: 3 }}>
          <h2 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 500 }}>Memory progress</h2>
          <div className="mt-4 space-y-3">
            {memoryStages.map(stage => (
              <MemoryStage key={stage.stage} label={stage.stage} count={stage.count} total={stats.totalQuestions} />
            ))}
          </div>
          {stats.totalQuestions === 0 && <NoData className="mt-4">No memory stages yet.</NoData>}
        </div>
      </section>
    </>
  )
}

function QuestionsPanel({
  totalQuestions,
  questionGroups,
}: {
  totalQuestions: number
  questionGroups: QuestionGroup[]
}) {
  return (
    <section className="py-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="rr-mono mb-1">Questions</div>
          <h2 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 500 }}>Question groups</h2>
          <p className="rr-prose" style={{ fontSize: '0.95rem' }}>
            Groups are organized by source card. Start quiz opens the card quiz runner for that group.
          </p>
        </div>
        <span className="rr-mono">{totalQuestions} total</span>
      </div>
      {questionGroups.length > 0 ? (
        <div className="space-y-3">
          {questionGroups.map(group => (
            <div key={group.cardId} className="flex flex-col gap-3 py-3 rr-rule sm:flex-row sm:items-center sm:justify-between">
              <Link href={`/item/${group.cardId}`} className="min-w-0 rr-link">
                <span className="font-display block" style={{ fontSize: '1.05rem', overflowWrap: 'anywhere' }}>{group.title}</span>
                <span className="rr-mono mt-1 block">{group.count} questions · {group.due} due · {group.reviewed} reviewed</span>
              </Link>
              <Link className="rr-btn rr-btn-accent shrink-0" href={`/item/${group.cardId}?tab=quiz&quiz=start`} aria-label={`Start quiz for ${group.title}`}>
                Start quiz
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <NoData>No quiz questions yet. Open a card&apos;s Quiz tab to generate local active-recall questions or create a custom short-answer question.</NoData>
      )}
    </section>
  )
}

function reviewTabId(tab: ReviewTab): string {
  return `review-tab-${tab}`
}

function reviewPanelId(tab: ReviewTab): string {
  return `review-panel-${tab}`
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rr-card px-4 py-3" style={{ borderRadius: 3 }}>
      <div className="rr-mono">{label}</div>
      <div className="font-display mt-2" style={{ fontSize: '2rem', lineHeight: 1 }}>{value}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rr-rule pb-2">
      <div className="rr-mono">{label}</div>
      <div className="font-display mt-1" style={{ fontSize: '1.45rem', lineHeight: 1 }}>{value}</div>
    </div>
  )
}

function StreakStat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rr-rule pb-2">
      <div className="rr-mono">{label}</div>
      <div className="font-display mt-1 flex items-baseline gap-1" style={{ fontSize: '1.45rem', lineHeight: 1 }}>
        {highlight && value > 0 && <span aria-hidden style={{ fontSize: '1.1rem' }}>🔥</span>}
        <span>{value}</span>
        <span className="rr-mono" style={{ fontSize: '0.7rem', color: 'var(--sepia)' }}>{value === 1 ? 'day' : 'days'}</span>
      </div>
    </div>
  )
}

function ActivityStrip({ daily }: { daily: { date: string; count: number }[] }) {
  const max = daily.reduce((peak, day) => Math.max(peak, day.count), 0)
  return (
    <div className="mt-4">
      <div className="flex items-end gap-[3px]" style={{ height: 44 }} role="img" aria-label={`Daily review activity for the last ${daily.length} days`}>
        {daily.map(day => {
          const ratio = max > 0 ? day.count / max : 0
          return (
            <div
              key={day.date}
              className="flex-1 rounded-[2px]"
              title={`${day.date}: ${day.count} ${day.count === 1 ? 'review' : 'reviews'}`}
              style={{
                height: day.count > 0 ? `${Math.max(14, ratio * 100)}%` : 4,
                minWidth: 3,
                background: day.count > 0 ? 'var(--accent)' : 'var(--hairline, var(--paper))',
                opacity: day.count > 0 ? 0.35 + ratio * 0.65 : 1,
              }}
            />
          )
        })}
      </div>
      <div className="mt-1 flex justify-between rr-mono" style={{ color: 'var(--sepia)' }}>
        <span>{daily.length} days ago</span>
        <span>Today</span>
      </div>
    </div>
  )
}

function MemoryStage({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="rr-mono" style={{ textTransform: 'capitalize' }}>{label}</span>
        <span className="rr-mono">{count} · {pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rr-rule" style={{ borderRadius: 999, background: 'var(--paper)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  )
}

function NoData({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`rr-prose ${className}`} style={{ fontSize: '0.92rem', color: 'var(--sepia)' }}>
      {children}
    </p>
  )
}

function isReviewResponse(data: unknown): data is { ok: true; question: unknown } {
  return data !== null &&
    typeof data === 'object' &&
    'ok' in data &&
    data.ok === true &&
    'question' in data &&
    data.question !== null &&
    typeof data.question === 'object'
}

function questionOptions(question: ReviewQuestion | null): string[] {
  return question?.type === 'mcq' && Array.isArray(question.options) ? question.options.filter(Boolean) : []
}

function normalizeAnswer(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function apiError(data: unknown, fallback: string): string {
  if (data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error
  }
  return fallback
}
