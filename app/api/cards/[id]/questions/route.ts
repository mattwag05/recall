import { NextResponse } from 'next/server'
import { createManualQuizQuestion, QuizQuestionError } from '@/lib/quiz-actions'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = await createManualQuizQuestion(id, body && typeof body === 'object' ? body : {})
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof QuizQuestionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Could not create quiz question: ${String(err)}` }, { status: 500 })
  }
}
