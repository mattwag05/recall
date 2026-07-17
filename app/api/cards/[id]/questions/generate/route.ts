import { NextResponse } from 'next/server'
import { generateQuizQuestionsForCard, QuizGenerationError } from '@/lib/quiz-generator'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params
  try {
    let count: number | undefined
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null) as unknown
      if (body && typeof body === 'object' && typeof (body as { count?: unknown }).count === 'number') {
        count = (body as { count: number }).count
      }
    }
    const result = await generateQuizQuestionsForCard(id, count)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof QuizGenerationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Could not generate quiz questions: ${String(err)}` }, { status: 500 })
  }
}
