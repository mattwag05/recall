import { NextResponse } from 'next/server'
import { categoryFilterExists, exportCsv, exportJson, exportZip, ExportFilters } from '@/lib/exporter'

export const runtime = 'nodejs'

type ExportFormat = 'csv' | 'json' | 'zip'

function parseFormat(value: string | null): ExportFormat | null {
  if (!value) return 'json'
  if (value === 'csv' || value === 'json' || value === 'zip') return value
  return null
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const format = parseFormat(searchParams.get('format'))
  if (!format) {
    return NextResponse.json({ error: 'Unsupported export format. Use json, csv, or zip.' }, { status: 400 })
  }

  const filters: ExportFilters = {
    platform: searchParams.get('platform') ?? undefined,
    category: searchParams.get('category') ?? undefined,
    actionability: searchParams.get('actionability') ?? undefined,
  }

  // Remove undefined keys
  if (!filters.platform) delete filters.platform
  if (!filters.category) delete filters.category
  if (!filters.actionability) delete filters.actionability

  try {
    if (!(await categoryFilterExists(filters.category))) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }
    const filenamePrefix = filters.category ? `recall-${filters.category}-` : ''

    if (format === 'csv') {
      const csv = await exportCsv(filters)
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filenamePrefix}bookmarks.csv"`,
        },
      })
    }

    if (format === 'zip') {
      const buffer = await exportZip(filters)
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filenamePrefix}bookmarks.zip"`,
        },
      })
    }

    // Default: json
    const data = await exportJson(filters)
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenamePrefix}bookmarks.json"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: `${format.toUpperCase()} export failed: ${String(err)}` }, { status: 500 })
  }
}
