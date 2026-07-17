import { InvalidPDFException, PasswordException, PDFParse } from 'pdf-parse'
import { extractImageTextForImport, ImageVisionError } from './image-vision'

export const MAX_CHAT_PDF_BYTES = 1024 * 1024
export const MAX_CHAT_PDF_CHARS = 12000
export const MAX_IMPORT_PDF_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_PDF_CHARS = 120000
export const MAX_IMPORT_PDF_OCR_PAGES = 3

type PdfTextResult = {
  text: string
  pageCount: number
  truncated: boolean
  ocr?: boolean
  ocrPages?: number
}

export class PdfTextExtractionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function extractPdfTextForChat(data: Uint8Array, filename: string): Promise<PdfTextResult> {
  return extractPdfText(data, filename, {
    maxBytes: MAX_CHAT_PDF_BYTES,
    maxChars: MAX_CHAT_PDF_CHARS,
    emptyTextMessage: `${filename.trim() || 'PDF'} has no extractable text. Scanned PDFs need OCR before chat can use them.`,
  })
}

export async function extractPdfTextForImport(data: Uint8Array, filename: string): Promise<PdfTextResult> {
  return extractPdfText(data, filename, {
    maxBytes: MAX_IMPORT_PDF_BYTES,
    maxChars: MAX_IMPORT_PDF_CHARS,
    emptyTextMessage: `${filename.trim() || 'PDF'} has no extractable text. Scanned PDFs need OCR before they can be saved as cards.`,
  })
}

export async function extractPdfTextOrOcrForImport(data: Uint8Array, filename: string): Promise<PdfTextResult> {
  const ocrData = new Uint8Array(data)
  try {
    return await extractPdfTextForImport(data, filename)
  } catch (err) {
    if (err instanceof PdfTextExtractionError && err.status === 422 && err.message.includes('no extractable text')) {
      return extractScannedPdfTextForImport(ocrData, filename)
    }
    throw err
  }
}

async function extractPdfText(
  data: Uint8Array,
  filename: string,
  options: { maxBytes: number; maxChars: number; emptyTextMessage: string },
): Promise<PdfTextResult> {
  const name = filename.trim() || 'PDF'
  if (data.byteLength === 0) throw new PdfTextExtractionError(`${name} is empty.`, 400)
  if (data.byteLength > options.maxBytes) throw new PdfTextExtractionError(`${name} is larger than ${formatBytes(options.maxBytes)}.`, 400)
  if (!looksLikePdf(data)) throw new PdfTextExtractionError(`${name} is not a valid PDF file.`, 400)

  const parser = new PDFParse({ data })
  try {
    const result = await parser.getText({ pageJoiner: '\n\n' })
    const normalized = normalizePdfText(result.text)
    if (!normalized) {
      throw new PdfTextExtractionError(options.emptyTextMessage, 422)
    }
    const text = normalized.slice(0, options.maxChars)
    return {
      text,
      pageCount: result.total,
      truncated: normalized.length > text.length,
    }
  } catch (err) {
    if (err instanceof PdfTextExtractionError) throw err
    if (err instanceof PasswordException) {
      throw new PdfTextExtractionError(`${name} is password protected. Unlock it before uploading.`, 422)
    }
    if (err instanceof InvalidPDFException) {
      throw new PdfTextExtractionError(`${name} is not a valid PDF file.`, 400)
    }
    throw new PdfTextExtractionError(`Could not extract text from ${name}: ${String(err)}`, 422)
  } finally {
    await parser.destroy()
  }
}

async function extractScannedPdfTextForImport(data: Uint8Array, filename: string): Promise<PdfTextResult> {
  const name = filename.trim() || 'PDF'
  const parser = new PDFParse({ data })
  try {
    const info = await parser.getInfo()
    const screenshots = await parser.getScreenshot({
      first: MAX_IMPORT_PDF_OCR_PAGES,
      desiredWidth: 1200,
      imageBuffer: true,
      imageDataUrl: false,
    })
    const sections: string[] = []
    let pageTextWasTruncated = false
    for (const page of screenshots.pages) {
      if (!page.data || page.data.byteLength === 0) continue
      try {
        const extracted = await extractImageTextForImport(page.data, `${name} page ${page.pageNumber}`, 'image/png')
        if (extracted.truncated) pageTextWasTruncated = true
        sections.push(`## Page ${page.pageNumber}\n${extracted.text}`)
      } catch (err) {
        if (err instanceof ImageVisionError) {
          throw new PdfTextExtractionError(`Scanned PDF OCR is unavailable for ${name}: ${err.message}`, err.status)
        }
        throw err
      }
    }

    const normalized = normalizePdfText(sections.join('\n\n'))
    if (!normalized) {
      throw new PdfTextExtractionError(`${name} did not produce readable OCR text from the first ${MAX_IMPORT_PDF_OCR_PAGES} pages.`, 422)
    }
    const text = normalized.slice(0, MAX_IMPORT_PDF_CHARS)
    return {
      text,
      pageCount: info.total,
      truncated: normalized.length > text.length || info.total > screenshots.pages.length || pageTextWasTruncated,
      ocr: true,
      ocrPages: screenshots.pages.length,
    }
  } catch (err) {
    if (err instanceof PdfTextExtractionError) throw err
    if (err instanceof PasswordException) {
      throw new PdfTextExtractionError(`${name} is password protected. Unlock it before uploading.`, 422)
    }
    if (err instanceof InvalidPDFException) {
      throw new PdfTextExtractionError(`${name} is not a valid PDF file.`, 400)
    }
    throw new PdfTextExtractionError(`Could not OCR ${name}: ${String(err)}`, 422)
  } finally {
    await parser.destroy()
  }
}

function formatBytes(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MB`
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`
  return `${bytes} B`
}

function looksLikePdf(data: Uint8Array): boolean {
  const prefix = new TextDecoder('ascii').decode(data.slice(0, Math.min(data.byteLength, 1024)))
  return prefix.includes('%PDF-')
}

function normalizePdfText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
