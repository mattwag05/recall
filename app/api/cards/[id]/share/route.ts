import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getPrisma } from '@/lib/db'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/cards/:id/share — make the card shareable (idempotent). Returns a
// stable, unguessable shareId for the read-only /share/:shareId page.
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const prisma = getPrisma()
    const card = await prisma.bookmark.findUnique({ where: { id }, select: { id: true, shared: true, shareId: true } })
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    if (card.shared && card.shareId) {
      return NextResponse.json({ ok: true, shareId: card.shareId })
    }
    // Reuse an existing id if present; otherwise mint an unguessable one.
    const shareId = card.shareId ?? randomBytes(16).toString('hex')
    await prisma.bookmark.update({ where: { id }, data: { shared: true, shareId } })
    return NextResponse.json({ ok: true, shareId })
  } catch (err) {
    return NextResponse.json({ error: `Could not share card: ${String(err)}` }, { status: 500 })
  }
}

// DELETE /api/cards/:id/share — revoke sharing (idempotent). Clears the shareId
// so the public link stops resolving.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const prisma = getPrisma()
    const card = await prisma.bookmark.findUnique({ where: { id }, select: { id: true } })
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    await prisma.bookmark.update({ where: { id }, data: { shared: false, shareId: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: `Could not unshare card: ${String(err)}` }, { status: 500 })
  }
}
