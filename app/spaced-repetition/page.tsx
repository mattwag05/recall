import Link from 'next/link'
import { getPrisma } from '@/lib/db'
import { getReviewActivity } from '@/lib/review-activity'
import { SpacedRepetitionDashboard, type QuestionGroup, type ReviewQuestion } from '@/components/recall/spaced-repetition-dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MEMORY_STAGES = ['new', 'learning', 'practiced', 'confident', 'mastered'] as const

export default async function SpacedRepetitionPage() {
  const prisma = getPrisma()
  const now = new Date()
  const inSevenDays = addDays(now, 7)
  const inFourteenDays = addDays(now, 14)
  const thirtyDaysAgo = addDays(now, -30)
  const [totalQuestions, dueQuestions, dueThisWeek, dueNextWeek, questions, memoryGroups, activity] = await Promise.all([
    prisma.quizQuestion.count(),
    prisma.quizQuestion.count({ where: { OR: [{ dueAt: null }, { dueAt: { lte: now } }] } }),
    prisma.quizQuestion.count({ where: { dueAt: { gt: now, lte: inSevenDays } } }),
    prisma.quizQuestion.count({ where: { dueAt: { gt: inSevenDays, lte: inFourteenDays } } }),
    prisma.quizQuestion.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        memoryStage: true,
        prompt: true,
        answer: true,
        type: true,
        options: true,
        origin: true,
        dueAt: true,
        lastReviewed: true,
        timesSeen: true,
        timesCorrect: true,
        bookmark: { select: { id: true, title: true, text: true } },
      },
    }),
    prisma.quizQuestion.groupBy({
      by: ['memoryStage'],
      _count: { _all: true },
    }),
    getReviewActivity(30),
  ])

  const grouped = questions.reduce<Map<string, QuestionGroup>>((acc, question) => {
    const cardId = question.bookmark.id
    const title = question.bookmark.title || question.bookmark.text.slice(0, 80) || 'Untitled'
    const existing = acc.get(cardId)
    const group = existing ?? { cardId, title, count: 0, due: 0, reviewed: 0 }
    group.count += 1
    if (!question.dueAt || question.dueAt <= now) group.due += 1
    if (question.timesSeen > 0) group.reviewed += 1
    acc.set(cardId, group)
    return acc
  }, new Map())
  const questionGroups = [...grouped.values()].sort((a, b) => b.due - a.due || b.count - a.count || a.title.localeCompare(b.title))
  const answered = questions.reduce((sum, question) => sum + question.timesSeen, 0)
  const correct = questions.reduce((sum, question) => sum + question.timesCorrect, 0)
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0
  const reviewedLast30 = questions.filter(question => question.lastReviewed && question.lastReviewed >= thirtyDaysAgo).length
  const memoryCounts = new Map(memoryGroups.map(group => [group.memoryStage, group._count._all]))
  const reviewQueue: ReviewQuestion[] = questions
    .filter(question => !question.dueAt || question.dueAt <= now)
    .map(question => ({
      id: question.id,
      cardId: question.bookmark.id,
      cardTitle: question.bookmark.title || question.bookmark.text.slice(0, 80) || 'Untitled',
      prompt: question.prompt,
      answer: question.answer,
      type: question.type,
      options: parseQuestionOptions(question.options),
      origin: question.origin,
      memoryStage: question.memoryStage,
      dueAt: question.dueAt ? question.dueAt.toISOString() : null,
      timesSeen: question.timesSeen,
      timesCorrect: question.timesCorrect,
    }))
    .sort((a, b) => questionDueSort(a.dueAt, b.dueAt) || a.cardTitle.localeCompare(b.cardTitle) || a.prompt.localeCompare(b.prompt))

  return (
    <div className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <header className="flex flex-col gap-3 pt-10 pb-5 rr-rule sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="rr-mono" style={{ color: 'var(--gold)' }}>Phase 3 route</p>
          <h1 className="font-display" style={{ fontSize: '2.2rem', fontWeight: 500 }}>Spaced repetition</h1>
          <p className="rr-prose mt-2" style={{ fontSize: '0.95rem' }}>
            Due short-answer and multiple-choice questions can now be reviewed with browser-local session and daily-goal preferences.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Link className="rr-btn" href="/settings#quiz" aria-label="Open quiz settings">Quiz settings</Link>
          <Link href="/items" className="rr-btn">Library</Link>
        </div>
      </header>

      <SpacedRepetitionDashboard
        metrics={{
          dueQuestions,
          dueThisWeek,
          dueNextWeek,
        }}
        stats={{
          answered,
          correct,
          accuracy,
          reviewedLast30,
          totalQuestions,
        }}
        memoryStages={MEMORY_STAGES.map(stage => ({ stage, count: memoryCounts.get(stage) ?? 0 }))}
        questionGroups={questionGroups}
        reviewQueue={reviewQueue}
        activity={activity}
      />
    </div>
  )
}

function parseQuestionOptions(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((option): option is string => typeof option === 'string') : []
  } catch {
    return []
  }
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function questionDueSort(a: string | null, b: string | null) {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  return new Date(a).getTime() - new Date(b).getTime()
}
