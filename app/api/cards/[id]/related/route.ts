import { NextResponse } from 'next/server'
import { findRelatedCards } from '@/lib/related-cards'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const limitParam = searchParams.get('limit')
  const limit = limitParam === null ? undefined : Number(limitParam)

  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return NextResponse.json({ error: 'Related card limit must be a positive number.' }, { status: 400 })
  }

  try {
    const cards = await findRelatedCards(id, limit)
    if (!cards) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    return NextResponse.json({ cards, mode: 'semantic' })
  } catch (err) {
    return NextResponse.json(
      { error: `Could not find related cards: ${String(err)}` },
      { status: 503 },
    )
  }
}
