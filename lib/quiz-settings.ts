// The two numbers the Quiz tab used to hardcode: the timed-quiz clock and how
// many questions "Generate Questions" asks for. Persisted like the other
// reading preferences.

export const QUIZ_SETTINGS_KEY = 'recall:quiz-settings:v1'

export interface QuizSettings {
  timerSeconds: number
  generateCount: number
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = { timerSeconds: 60, generateCount: 5 }

export const TIMER_SECONDS_RANGE = { min: 15, max: 300 } as const
export const GENERATE_COUNT_RANGE = { min: 1, max: 20 } as const

function clamp(value: unknown, fallback: number, range: { min: number; max: number }): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(range.max, Math.max(range.min, Math.round(numeric)))
}

export function parseQuizSettings(raw: string | null): QuizSettings {
  if (!raw) return DEFAULT_QUIZ_SETTINGS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_QUIZ_SETTINGS
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_QUIZ_SETTINGS
  const record = parsed as Record<string, unknown>
  return {
    timerSeconds: clamp(record.timerSeconds, DEFAULT_QUIZ_SETTINGS.timerSeconds, TIMER_SECONDS_RANGE),
    generateCount: clamp(record.generateCount, DEFAULT_QUIZ_SETTINGS.generateCount, GENERATE_COUNT_RANGE),
  }
}

export function normalizeQuizSettings(settings: Partial<QuizSettings>): QuizSettings {
  return {
    timerSeconds: clamp(settings.timerSeconds, DEFAULT_QUIZ_SETTINGS.timerSeconds, TIMER_SECONDS_RANGE),
    generateCount: clamp(settings.generateCount, DEFAULT_QUIZ_SETTINGS.generateCount, GENERATE_COUNT_RANGE),
  }
}

export function readQuizSettings(): QuizSettings {
  if (typeof window === 'undefined') return DEFAULT_QUIZ_SETTINGS
  try {
    return parseQuizSettings(localStorage.getItem(QUIZ_SETTINGS_KEY))
  } catch {
    return DEFAULT_QUIZ_SETTINGS
  }
}

export function writeQuizSettings(settings: QuizSettings) {
  try { localStorage.setItem(QUIZ_SETTINGS_KEY, JSON.stringify(normalizeQuizSettings(settings))) } catch {}
}
