import { NextResponse } from 'next/server'
import { QuizQuestionError, reviewQuizQuestion } from '@/lib/quiz-actions'

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
    return NextResponse.json({ error: `Could not review quiz question: ${String(err)}` }, { status: 500 })
  }
}
