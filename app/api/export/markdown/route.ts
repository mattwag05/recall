import { NextResponse } from 'next/server'
import { categoryFilterExists, exportMarkdown, type ExportFilters } from '@/lib/exporter'

export const runtime = 'nodejs'

// GET /api/export/markdown?category=tag-slug — library Markdown export
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const filters: ExportFilters = {
      category: searchParams.get('category') ?? undefined,
    }
    if (!filters.category) delete filters.category
    if (!(await categoryFilterExists(filters.category))) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    const { markdown } = await exportMarkdown(filters)
    const filename = filters.category ? `recall-${filters.category}-export.md` : 'recall-export.md'

    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: `Markdown export failed: ${String(err)}` }, { status: 500 })
  }
}
