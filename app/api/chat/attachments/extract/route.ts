import { NextResponse } from 'next/server'
import { extractImageTextForChat, chatImageMimeType, ImageVisionError, MAX_CHAT_IMAGE_BYTES } from '@/lib/image-vision'
import { extractPdfTextForChat, MAX_CHAT_PDF_BYTES, PdfTextExtractionError } from '@/lib/pdf-text'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Upload a PDF or supported image file to extract chat context.' }, { status: 400 })
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const isPdf = file.type === 'application/pdf' || extension === 'pdf'
    const imageMimeType = chatImageMimeType(file.type, file.name)
    if (!isPdf && !imageMimeType) {
      return NextResponse.json({ error: `${file.name || 'This file'} is not a readable PDF, PNG, JPG, or WebP file.` }, { status: 400 })
    }

    const data = new Uint8Array(await file.arrayBuffer())
    if (isPdf) return NextResponse.json(await extractPdfAttachment(data, file))
    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      return NextResponse.json({ error: `${file.name || 'This image'} is larger than 1 MB.` }, { status: 400 })
    }
    if (!imageMimeType) {
      return NextResponse.json({ error: `${file.name || 'This image'} must be a PNG, JPG, or WebP image for OCR/vision.` }, { status: 400 })
    }
    return NextResponse.json(await extractImageAttachment(data, file, imageMimeType))
  } catch (err) {
    if (err instanceof PdfTextExtractionError || err instanceof ImageVisionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: `Attachment extraction failed: ${String(err)}` }, { status: 500 })
  }
}

async function extractPdfAttachment(data: Uint8Array, file: File) {
  if (file.size > MAX_CHAT_PDF_BYTES) {
    throw new PdfTextExtractionError(`${file.name || 'This PDF'} is larger than 1 MB.`, 400)
  }
  const extracted = await extractPdfTextForChat(data, file.name)
  return {
    ok: true,
    attachment: {
      name: file.name || 'document.pdf',
      type: 'application/pdf',
      size: file.size,
      text: extracted.text,
    },
    kind: 'pdf',
    pageCount: extracted.pageCount,
    truncated: extracted.truncated,
  }
}

async function extractImageAttachment(data: Uint8Array, file: File, mimeType: string) {
  const extracted = await extractImageTextForChat(data, file.name, mimeType)
  return {
    ok: true,
    attachment: {
      name: file.name || 'image',
      type: mimeType,
      size: file.size,
      text: extracted.text,
    },
    kind: 'image',
    truncated: extracted.truncated,
  }
}
