import { NextResponse } from 'next/server'
import { QuizQuestionError, reviewQuizQuestion } from '@/lib/quiz-actions'
import { apiError } from '@/lib/api-errors'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string; questionId: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const { id, questionId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const question = await reviewQuizQuestion(id, questionId, body && typeof body === 'object' ? body : {})
    return NextResponse.json({ ok: true, question })
  } catch (err) {
    if (err instanceof QuizQuestionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return apiError('Could not review quiz question', err, 500)
  }
}
