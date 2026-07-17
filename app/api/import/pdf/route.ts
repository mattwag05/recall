import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { extractPdfTextOrOcrForImport, MAX_IMPORT_PDF_BYTES, PdfTextExtractionError } from '@/lib/pdf-text'

export const runtime = 'nodejs'

const MAX_PDF_IMPORT_FILES = 10

type PdfImportCard = {
  id: string
  title: string
  status: string
  extracted: boolean
  skipped?: boolean
  message?: string
}

type PdfImportFailure = {
  name: string
  error: string
  status: number
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'Choose at least one PDF file before importing.' }, { status: 400 })
    }
    if (files.length > MAX_PDF_IMPORT_FILES) {
      return NextResponse.json({ error: `Import up to ${MAX_PDF_IMPORT_FILES} PDFs at a time.` }, { status: 400 })
    }

    const cards: PdfImportCard[] = []
    const failures: PdfImportFailure[] = []

    for (const file of files) {
      const name = file.name || 'document.pdf'
      try {
        const extension = name.split('.').pop()?.toLowerCase() ?? ''
        if (file.type !== 'application/pdf' && extension !== 'pdf') {
          throw new PdfTextExtractionError(`${name} is not a PDF file.`, 400)
        }
        if (file.size > MAX_IMPORT_PDF_BYTES) {
          throw new PdfTextExtractionError(`${name} is larger than 10 MB.`, 400)
        }

        const data = new Uint8Array(await file.arrayBuffer())
        const hash = createHash('sha256').update(data).digest('hex')
        const postId = `pdf:${hash}`
        const prisma = getPrisma()
        const existing = await prisma.bookmark.findUnique({
          where: { postId },
          select: { id: true, title: true, text: true, status: true },
        })
        if (existing) {
          cards.push({
            id: existing.id,
            title: cardTitle(existing.title, existing.text),
            status: existing.status,
            extracted: true,
            skipped: true,
            message: `${name} is already in your library.`,
          })
          continue
        }

        const extracted = await extractPdfTextOrOcrForImport(data, name)
        const title = titleFromFilename(name)
        const text = excerptForPdf(extracted.text, title)
        const bookmark = await prisma.bookmark.create({
          data: {
            postId,
            platform: 'document',
            title,
            provider: 'pdf',
            text,
            body: extracted.text,
            postUrl: '',
            sourceType: 'document',
            saveAction: 'saved',
            status: 'organizing',
            postCreatedAt: new Date(),
            rawJson: JSON.stringify({
              postId,
              filename: name,
              fileType: file.type || 'application/pdf',
              fileSize: file.size,
              sha256: hash,
              pageCount: extracted.pageCount,
              truncated: extracted.truncated,
              ocr: extracted.ocr === true,
              ocrPages: extracted.ocrPages ?? 0,
            }),
          },
        })

        try {
          indexBookmark({
            bookmarkId: bookmark.id,
            title,
            text,
            body: extracted.text,
          })
        } catch {}

        cards.push({
          id: bookmark.id,
          title,
          status: bookmark.status,
          extracted: true,
          message: pdfImportCardMessage(name, extracted),
        })
      } catch (err) {
        failures.push({
          name,
          error: err instanceof Error ? err.message : `Could not import ${name}.`,
          status: err instanceof PdfTextExtractionError ? err.status : 500,
        })
      }
    }

    if (cards.length === 0) {
      return NextResponse.json({
        ok: false,
        error: failures[0]?.error ?? 'No PDFs could be imported.',
        failures,
      }, { status: failures[0]?.status ?? 400 })
    }

    return NextResponse.json({
      ok: true,
      cards,
      failures,
      imported: cards.filter(card => !card.skipped).length,
      skipped: cards.filter(card => card.skipped).length,
      failed: failures.length,
    })
  } catch (err) {
    return NextResponse.json({ error: `PDF import failed: ${String(err)}` }, { status: 500 })
  }
}

function titleFromFilename(filename: string): string {
  const withoutPath = filename.split(/[\\/]/).pop() || 'PDF'
  const withoutExtension = withoutPath.replace(/\.pdf$/i, '').trim()
  return withoutExtension || 'PDF'
}

function cardTitle(title: string | null, text: string): string {
  return title || text.slice(0, 120) || 'PDF'
}

function excerptForPdf(text: string, title: string): string {
  const firstLine = text.split('\n').map(line => line.trim()).find(Boolean)
  return (firstLine || title).slice(0, 280)
}

function pdfImportCardMessage(
  filename: string,
  extracted: { truncated: boolean; ocr?: boolean; ocrPages?: number },
): string | undefined {
  if (extracted.ocr) {
    const pages = extracted.ocrPages ?? 0
    const pageLabel = pages === 1 ? 'first page' : `first ${pages} pages`
    return extracted.truncated
      ? `${filename} imported with local OCR from the ${pageLabel}; long OCR text was clipped.`
      : `${filename} imported with local OCR from the ${pageLabel}.`
  }
  return extracted.truncated ? `${filename} imported with long text clipped for local processing.` : undefined
}
