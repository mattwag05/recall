import { NextResponse } from 'next/server'
import { deleteQuizQuestion, QuizQuestionError, updateQuizQuestion } from '@/lib/quiz-actions'
import { apiError } from '@/lib/api-errors'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string; questionId: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, questionId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = await updateQuizQuestion(id, questionId, body && typeof body === 'object' ? body : {})
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof QuizQuestionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return apiError('Could not update quiz question', err, 500)
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, questionId } = await params
  try {
    const result = await deleteQuizQuestion(id, questionId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof QuizQuestionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return apiError('Could not delete quiz question', err, 500)
  }
}
