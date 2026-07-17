import { llmChat } from './ai-client'
import { getPrisma } from './db'
import { extractJson } from './json-utils'

const MAX_QUIZ_CONTEXT_CHARS = 14000
const DEFAULT_QUESTION_COUNT = 5
const MAX_QUESTION_COUNT = 8

export class QuizGenerationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export type QuizGenerationSummary = {
  created: number
  skipped: number
  total: number
}

type GeneratedQuestion = {
  prompt: string
  answer: string
  type: 'short' | 'mcq'
  options?: string[]
}

export async function generateQuizQuestionsForCard(
  bookmarkId: string,
  requestedCount = DEFAULT_QUESTION_COUNT,
): Promise<QuizGenerationSummary> {
  const prisma = getPrisma()
  const card = await prisma.bookmark.findUnique({
    where: { id: bookmarkId },
    select: {
      id: true,
      title: true,
      text: true,
      body: true,
      notebookContent: true,
      summary: true,
      quizQuestions: { select: { prompt: true } },
    },
  })
  if (!card) throw new QuizGenerationError('Card not found', 404)

  const source = quizSourceText(card)
  if (!source) {
    throw new QuizGenerationError('This card needs Notebook or Reader content before quiz questions can be generated.', 400)
  }

  const count = Math.max(1, Math.min(MAX_QUESTION_COUNT, Math.floor(requestedCount)))
  const existingPrompts = new Set(card.quizQuestions.map(question => normalizePrompt(question.prompt)))
  let content: string
  try {
    content = await llmChat([
      { role: 'user', content: quizPrompt(card.title || card.text.slice(0, 120) || 'Untitled', source, count) },
    ], {
      stage: 'quiz_generation',
      system: quizSystemPrompt(),
      temperature: 0.25,
      maxTokens: 1200,
    })
  } catch (err) {
    throw new QuizGenerationError(`Quiz generation is unavailable from the local model: ${String(err)}`, 503)
  }

  const questions = parseGeneratedQuestions(content)
  if (questions.length === 0) {
    throw new QuizGenerationError('The local model did not return usable quiz questions. Try again after regenerating the Notebook.', 502)
  }

  let created = 0
  let skipped = 0
  const dueAt = new Date()
  for (const question of questions.slice(0, count)) {
    const key = normalizePrompt(question.prompt)
    if (!key || existingPrompts.has(key)) {
      skipped += 1
      continue
    }
    await prisma.quizQuestion.create({
      data: {
        bookmarkId,
        prompt: question.prompt,
        answer: question.answer,
        type: question.type,
        options: question.type === 'mcq' ? JSON.stringify(question.options) : undefined,
        origin: 'ai',
        memoryStage: 'new',
        dueAt,
      },
    })
    existingPrompts.add(key)
    created += 1
  }

  return {
    created,
    skipped,
    total: await prisma.quizQuestion.count({ where: { bookmarkId } }),
  }
}

function quizSystemPrompt(): string {
  return [
    'You generate active-recall quiz questions for Recall cards.',
    'Use only the supplied card content.',
    'Prefer questions that test specific claims, distinctions, sequences, terms, tradeoffs, or implications.',
    'Do not ask vague opinion questions.',
    'Return only valid JSON.',
  ].join(' ')
}

function quizPrompt(title: string, source: string, count: number): string {
  return [
    `Create ${count} active-recall questions for this card: mix short-answer and multiple-choice questions.`,
    `Title: ${title}`,
    '',
    'Return JSON shaped exactly like:',
    '{"questions":[{"prompt":"Question?","answer":"Concise answer grounded in the card.","type":"short"},{"prompt":"Question?","answer":"Correct option","type":"mcq","options":["Correct option","Plausible wrong option","Another wrong option","Another wrong option"]}]}',
    'For mcq questions, include 3-5 options and make answer exactly match one option.',
    '',
    'Card content:',
    source,
  ].join('\n')
}

function quizSourceText(card: {
  title: string | null
  text: string
  body: string | null
  notebookContent: string | null
  summary: string | null
}): string {
  const chunks = [
    card.title ? `Title: ${card.title}` : null,
    card.summary ? `Summary:\n${card.summary}` : null,
    card.notebookContent ? `Notebook:\n${card.notebookContent}` : null,
    card.body ? `Reader:\n${card.body}` : null,
    card.text ? `Excerpt:\n${card.text}` : null,
  ].filter((chunk): chunk is string => Boolean(chunk))
  return chunks.join('\n\n').slice(0, MAX_QUIZ_CONTEXT_CHARS).trim()
}

function parseGeneratedQuestions(content: string): GeneratedQuestion[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    return []
  }
  const value = parsed && typeof parsed === 'object' && 'questions' in parsed
    ? (parsed as { questions?: unknown }).questions
    : parsed
  if (!Array.isArray(value)) return []
  return value.flatMap((item): GeneratedQuestion[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const prompt = cleanText(record.prompt)
    const answer = cleanText(record.answer)
    if (!prompt || !answer) return []
    const type = record.type === 'mcq' ? 'mcq' : 'short'
    if (type === 'short') return [{ prompt, answer, type }]
    const options = cleanOptions(record.options, answer)
    if (options.length < 2) return [{ prompt, answer, type: 'short' as const }]
    return [{ prompt, answer, type, options }]
  })
}

function cleanOptions(value: unknown, answer: string): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const options = value.flatMap(option => {
    const text = cleanText(option).slice(0, 300)
    const key = normalizePrompt(text)
    if (!text || seen.has(key)) return []
    seen.add(key)
    return [text]
  }).slice(0, 5)
  if (!options.some(option => normalizePrompt(option) === normalizePrompt(answer))) {
    options.unshift(answer)
  }
  return options.slice(0, 5)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 1200) : ''
}

function normalizePrompt(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

export const __quizGeneratorTest = {
  parseGeneratedQuestions,
}
