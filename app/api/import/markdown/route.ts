import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'

export const runtime = 'nodejs'

const MAX_MARKDOWN_IMPORT_FILES = 10
const MAX_MARKDOWN_IMPORT_BYTES = 2 * 1024 * 1024
const MAX_MARKDOWN_BODY_CHARS = 120_000

type MarkdownImportCard = {
  id: string
  title: string
  status: string
  extracted: boolean
  skipped?: boolean
  message?: string
}

type MarkdownImportFailure = {
  name: string
  error: string
  status: number
}

class MarkdownImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'Choose at least one Markdown file before importing.' }, { status: 400 })
    }
    if (files.length > MAX_MARKDOWN_IMPORT_FILES) {
      return NextResponse.json({ error: `Import up to ${MAX_MARKDOWN_IMPORT_FILES} Markdown files at a time.` }, { status: 400 })
    }

    const cards: MarkdownImportCard[] = []
    const failures: MarkdownImportFailure[] = []

    for (const file of files) {
      const name = file.name || 'document.md'
      try {
        if (!isMarkdownFile(file, name)) {
          throw new MarkdownImportError(`${name} is not a Markdown file.`, 400)
        }
        if (file.size > MAX_MARKDOWN_IMPORT_BYTES) {
          throw new MarkdownImportError(`${name} is larger than 2 MB.`, 400)
        }

        const data = new Uint8Array(await file.arrayBuffer())
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/\u0000/g, '')
        const body = decoded.trim()
        if (!body) throw new MarkdownImportError(`${name} is empty.`, 400)

        const hash = createHash('sha256').update(data).digest('hex')
        const postId = `markdown:${hash}`
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

        const title = titleFromMarkdown(name, body)
        const clippedBody = body.length > MAX_MARKDOWN_BODY_CHARS
          ? `${body.slice(0, MAX_MARKDOWN_BODY_CHARS).trim()}\n\n[Markdown import clipped after ${MAX_MARKDOWN_BODY_CHARS.toLocaleString()} characters for local processing.]`
          : body
        const text = excerptForMarkdown(clippedBody, title)
        const bookmark = await prisma.bookmark.create({
          data: {
            postId,
            platform: 'document',
            title,
            provider: 'markdown',
            text,
            body: clippedBody,
            postUrl: '',
            sourceType: 'document',
            saveAction: 'saved',
            status: 'organizing',
            postCreatedAt: new Date(),
            rawJson: JSON.stringify({
              postId,
              filename: name,
              fileType: file.type || 'text/markdown',
              fileSize: file.size,
              sha256: hash,
              format: 'markdown',
              truncated: body.length > MAX_MARKDOWN_BODY_CHARS,
            }),
          },
        })

        try {
          indexBookmark({
            bookmarkId: bookmark.id,
            title,
            text,
            body: clippedBody,
          })
        } catch {}

        cards.push({
          id: bookmark.id,
          title,
          status: bookmark.status,
          extracted: true,
          message: body.length > MAX_MARKDOWN_BODY_CHARS
            ? `${name} imported with long Markdown clipped for local processing.`
            : undefined,
        })
      } catch (err) {
        failures.push({
          name,
          error: err instanceof Error ? err.message : `Could not import ${name}.`,
          status: err instanceof MarkdownImportError ? err.status : 500,
        })
      }
    }

    if (cards.length === 0) {
      return NextResponse.json({
        ok: false,
        error: failures[0]?.error ?? 'No Markdown files could be imported.',
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
    return NextResponse.json({ error: `Markdown import failed: ${String(err)}` }, { status: 500 })
  }
}

function isMarkdownFile(file: File, filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return extension === 'md' ||
    extension === 'markdown' ||
    file.type === 'text/markdown' ||
    file.type === 'text/x-markdown'
}

function titleFromMarkdown(filename: string, markdown: string): string {
  const frontmatterTitle = markdown.match(/^---\s*\n[\s\S]*?\ntitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?\n---/i)?.[1]?.trim()
  if (frontmatterTitle) return stripMarkdownInline(frontmatterTitle).slice(0, 160)

  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (h1) return stripMarkdownInline(h1).slice(0, 160)

  const withoutPath = filename.split(/[\\/]/).pop() || 'Markdown'
  const withoutExtension = withoutPath.replace(/\.(md|markdown)$/i, '').trim()
  return withoutExtension || 'Markdown'
}

function cardTitle(title: string | null, text: string): string {
  return title || text.slice(0, 120) || 'Markdown'
}

function excerptForMarkdown(markdown: string, title: string): string {
  const stripped = stripMarkdown(markdown)
  return (stripped || title).slice(0, 280)
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^---\s*\n[\s\S]*?\n---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map(line => stripMarkdownInline(line.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '').trim()))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
