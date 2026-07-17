import { getPrisma } from './db'
import { indexBookmarkById } from './fts'

const MAX_QUESTION_TEXT_CHARS = 1200
const MEMORY_STAGES = ['new', 'learning', 'practiced', 'confident', 'mastered'] as const

type MemoryStage = typeof MEMORY_STAGES[number]

export class QuizQuestionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function createManualQuizQuestion(bookmarkId: string, input: { prompt?: unknown; answer?: unknown }) {
  const prompt = cleanQuestionText(input.prompt)
  const answer = cleanQuestionText(input.answer)
  const type = parseQuestionType((input as { type?: unknown }).type)
  const options = type === 'mcq' ? cleanQuestionOptions((input as { options?: unknown }).options, answer) : []
  if (!prompt) throw new QuizQuestionError('Question prompt is required.', 400)
  if (!answer) throw new QuizQuestionError('Question answer is required.', 400)
  if (type === 'mcq' && options.length < 2) throw new QuizQuestionError('Multiple-choice questions need at least two options including the correct answer.', 400)

  const prisma = getPrisma()
  const card = await prisma.bookmark.findUnique({
    where: { id: bookmarkId },
    select: {
      id: true,
      quizQuestions: { select: { prompt: true } },
    },
  })
  if (!card) throw new QuizQuestionError('Card not found', 404)

  const existingPrompts = new Set(card.quizQuestions.map(question => normalizePrompt(question.prompt)))
  if (existingPrompts.has(normalizePrompt(prompt))) {
    throw new QuizQuestionError('A quiz question with that prompt already exists for this card.', 409)
  }

  const now = new Date()
  const question = await prisma.quizQuestion.create({
    data: {
      bookmarkId,
      prompt,
      answer,
      type,
      options: type === 'mcq' ? JSON.stringify(options) : null,
      origin: 'manual',
      memoryStage: 'new',
      dueAt: now,
    },
    select: quizQuestionSelect(),
  })
  indexBookmarkById(bookmarkId)
  return {
    question: serializeQuizQuestion(question),
    total: await prisma.quizQuestion.count({ where: { bookmarkId } }),
  }
}

export async function updateQuizQuestion(
  bookmarkId: string,
  questionId: string,
  input: { prompt?: unknown; answer?: unknown },
) {
  const prompt = cleanQuestionText(input.prompt)
  const answer = cleanQuestionText(input.answer)
  if (!prompt) throw new QuizQuestionError('Question prompt is required.', 400)
  if (!answer) throw new QuizQuestionError('Question answer is required.', 400)

  const prisma = getPrisma()
  const card = await prisma.bookmark.findUnique({
    where: { id: bookmarkId },
    select: {
      id: true,
      quizQuestions: { select: { id: true, prompt: true } },
    },
  })
  if (!card) throw new QuizQuestionError('Card not found', 404)
  if (!card.quizQuestions.some(question => question.id === questionId)) {
    throw new QuizQuestionError('Quiz question not found', 404)
  }

  const nextPrompt = normalizePrompt(prompt)
  const duplicate = card.quizQuestions.some(question => question.id !== questionId && normalizePrompt(question.prompt) === nextPrompt)
  if (duplicate) {
    throw new QuizQuestionError('A quiz question with that prompt already exists for this card.', 409)
  }

  const existing = await prisma.quizQuestion.findFirst({
    where: { id: questionId, bookmarkId },
    select: { id: true, type: true, options: true },
  })
  if (!existing) throw new QuizQuestionError('Quiz question not found', 404)
  if (existing.type === 'mcq') {
    const options = parseQuestionOptions(existing.options)
    if (options.length > 0 && !options.some(option => normalizePrompt(option) === normalizePrompt(answer))) {
      throw new QuizQuestionError('Multiple-choice answer must match one of the saved options.', 400)
    }
  }

  const question = await prisma.quizQuestion.update({
    where: { id: questionId },
    data: { prompt, answer },
    select: quizQuestionSelect(),
  })
  indexBookmarkById(bookmarkId)
  return {
    question: serializeQuizQuestion(question),
    total: await prisma.quizQuestion.count({ where: { bookmarkId } }),
  }
}

export async function deleteQuizQuestion(bookmarkId: string, questionId: string) {
  const prisma = getPrisma()
  const question = await prisma.quizQuestion.findFirst({
    where: { id: questionId, bookmarkId },
    select: { id: true },
  })
  if (!question) throw new QuizQuestionError('Quiz question not found', 404)

  await prisma.quizQuestion.delete({ where: { id: question.id } })
  indexBookmarkById(bookmarkId)
  return {
    total: await prisma.quizQuestion.count({ where: { bookmarkId } }),
  }
}

export async function reviewQuizQuestion(bookmarkId: string, questionId: string, input: { correct?: unknown }) {
  if (typeof input.correct !== 'boolean') {
    throw new QuizQuestionError('Review result must include a boolean correct value.', 400)
  }

  const prisma = getPrisma()
  const question = await prisma.quizQuestion.findFirst({
    where: { id: questionId, bookmarkId },
    select: {
      id: true,
      bookmarkId: true,
      memoryStage: true,
      ease: true,
      intervalDays: true,
      timesCorrect: true,
    },
  })
  if (!question) throw new QuizQuestionError('Quiz question not found', 404)

  const next = nextReviewState({
    correct: input.correct,
    memoryStage: parseMemoryStage(question.memoryStage),
    ease: question.ease,
    intervalDays: question.intervalDays,
  })
  const reviewed = await prisma.quizQuestion.update({
    where: { id: question.id },
    data: {
      memoryStage: next.memoryStage,
      ease: next.ease,
      intervalDays: next.intervalDays,
      dueAt: next.dueAt,
      lastReviewed: next.reviewedAt,
      timesSeen: { increment: 1 },
      timesCorrect: input.correct ? { increment: 1 } : undefined,
    },
    select: quizQuestionSelect(),
  })

  // ponytail: best-effort activity log — a logging failure must not fail a
  // review the user already completed (drives streaks/history only).
  try {
    await prisma.reviewLog.create({
      data: { questionId: question.id, bookmarkId, correct: input.correct, reviewedAt: next.reviewedAt },
    })
  } catch {}

  return serializeQuizQuestion(reviewed)
}

function nextReviewState({
  correct,
  memoryStage,
  ease,
  intervalDays,
}: {
  correct: boolean
  memoryStage: MemoryStage
  ease: number
  intervalDays: number
}) {
  const reviewedAt = new Date()
  if (!correct) {
    return {
      reviewedAt,
      memoryStage: 'learning',
      ease: Math.max(1.3, ease - 0.25),
      intervalDays: 0,
      dueAt: reviewedAt,
    }
  }

  const nextStage = advanceMemoryStage(memoryStage)
  const nextEase = Math.min(3, Math.max(1.3, ease + 0.05))
  const nextInterval = nextIntervalDays(nextStage, intervalDays, nextEase)
  return {
    reviewedAt,
    memoryStage: nextStage,
    ease: nextEase,
    intervalDays: nextInterval,
    dueAt: addDays(reviewedAt, nextInterval),
  }
}

function advanceMemoryStage(stage: MemoryStage): MemoryStage {
  if (stage === 'new') return 'learning'
  if (stage === 'learning') return 'practiced'
  if (stage === 'practiced') return 'confident'
  return 'mastered'
}

function nextIntervalDays(stage: MemoryStage, currentInterval: number, ease: number): number {
  if (stage === 'learning') return 1
  if (stage === 'practiced') return Math.max(3, Math.round(Math.max(currentInterval, 1) * ease))
  if (stage === 'confident') return Math.max(7, Math.round(Math.max(currentInterval, 3) * ease))
  if (stage === 'mastered') return Math.min(180, Math.max(21, Math.round(Math.max(currentInterval, 7) * ease)))
  return 0
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseMemoryStage(value: string): MemoryStage {
  return MEMORY_STAGES.includes(value as MemoryStage) ? value as MemoryStage : 'new'
}

function cleanQuestionText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_TEXT_CHARS) : ''
}

function normalizePrompt(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function quizQuestionSelect() {
  return {
    id: true,
    prompt: true,
    answer: true,
    type: true,
    origin: true,
    options: true,
    memoryStage: true,
    dueAt: true,
    lastReviewed: true,
    timesSeen: true,
    timesCorrect: true,
  } as const
}

function parseQuestionType(value: unknown): 'short' | 'mcq' {
  return value === 'mcq' ? 'mcq' : 'short'
}

function cleanQuestionOptions(value: unknown, answer: string): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const options = value.flatMap(option => {
    const text = cleanQuestionText(option).slice(0, 300)
    const key = normalizePrompt(text)
    if (!text || seen.has(key)) return []
    seen.add(key)
    return [text]
  }).slice(0, 6)
  if (!options.some(option => normalizePrompt(option) === normalizePrompt(answer))) options.unshift(answer)
  return options.slice(0, 6)
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

function serializeQuizQuestion<T extends { options: string | null }>(question: T): Omit<T, 'options'> & { options: string[] } {
  return {
    ...question,
    options: parseQuestionOptions(question.options),
  }
}
