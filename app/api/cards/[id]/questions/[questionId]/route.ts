import { NextResponse } from 'next/server'
import { deleteQuizQuestion, QuizQuestionError, updateQuizQuestion } from '@/lib/quiz-actions'

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
    return NextResponse.json({ error: `Could not update quiz question: ${String(err)}` }, { status: 500 })
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
    return NextResponse.json({ error: `Could not delete quiz question: ${String(err)}` }, { status: 500 })
  }
}
