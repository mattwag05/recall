import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { cardToMarkdown, slugifyTitle, type ExportableCard } from '@/lib/markdown-export'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/cards/:id/markdown — download a single card as Markdown
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const prisma = getPrisma()
    const b = await prisma.bookmark.findUnique({
      where: { id },
      include: {
        categories: { select: { category: { select: { name: true } } } },
        connectionsOut: {
          include: { to: true },
          orderBy: { createdAt: 'desc' },
        },
        quizQuestions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!b) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const md = cardToMarkdown(b as unknown as ExportableCard)
    const filename = `${slugifyTitle(b.title || b.text)}.md`
    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: `Card Markdown export failed: ${String(err)}` }, { status: 500 })
  }
}
