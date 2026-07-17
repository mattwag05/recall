import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { extractImageTextForImport, ImageVisionError, MAX_IMPORT_IMAGE_BYTES, savedImageMimeType } from '@/lib/image-vision'
import { extensionForImageMime, mediaLocalPath, saveMediaFile } from '@/lib/media-storage'

export const runtime = 'nodejs'

const MAX_IMAGE_IMPORT_FILES = 10

type ImageImportCard = {
  id: string
  title: string
  status: string
  extracted: boolean
  skipped?: boolean
  message?: string
}

type ImageImportFailure = {
  name: string
  error: string
  status: number
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'Choose at least one image before importing.' }, { status: 400 })
    }
    if (files.length > MAX_IMAGE_IMPORT_FILES) {
      return NextResponse.json({ error: `Import up to ${MAX_IMAGE_IMPORT_FILES} images at a time.` }, { status: 400 })
    }

    const cards: ImageImportCard[] = []
    const failures: ImageImportFailure[] = []

    for (const file of files) {
      const name = file.name || 'image'
      try {
        const mimeType = savedImageMimeType(file.type, name)
        if (!mimeType) {
          throw new ImageVisionError(`${name} must be a PNG, JPG, or WebP image.`, 400)
        }
        if (file.size > MAX_IMPORT_IMAGE_BYTES) {
          throw new ImageVisionError(`${name} is larger than 5 MB.`, 400)
        }

        const data = new Uint8Array(await file.arrayBuffer())
        const hash = createHash('sha256').update(data).digest('hex')
        const postId = `image:${hash}`
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
            extracted: existing.status !== 'failed',
            skipped: true,
            message: `${name} is already in your library.`,
          })
          continue
        }

        const extension = extensionForImageMime(mimeType)
        const localPath = mediaLocalPath('images', hash, extension)
        await saveMediaFile(localPath, data)

        const title = titleFromFilename(name)
        let body: string | null = null
        let tags: string[] = []
        let status = 'organizing'
        let visionError: string | null = null
        let truncated = false
        try {
          const extracted = await extractImageTextForImport(data, name, mimeType)
          body = extracted.text
          tags = extracted.tags
          truncated = extracted.truncated
        } catch (err) {
          status = 'failed'
          visionError = err instanceof Error ? err.message : `Could not extract OCR/vision text from ${name}.`
        }

        const mediaId = `image_${hash.slice(0, 32)}`
        const mediaUrl = `/media/${localPath.replaceAll('\\', '/')}`
        const text = body ? excerptForImage(body, title) : `${title} saved as a local image. OCR/vision text is unavailable.`
        const bookmark = await prisma.bookmark.create({
          data: {
            postId,
            platform: 'image',
            title,
            provider: 'image',
            text,
            body,
            postUrl: mediaUrl,
            thumbnail: mediaUrl,
            sourceType: 'image',
            saveAction: 'saved',
            status,
            postCreatedAt: new Date(),
            rawJson: JSON.stringify({
              postId,
              filename: name,
              fileType: mimeType,
              fileSize: file.size,
              sha256: hash,
              localPath,
              truncated,
              visionError,
            }),
            mediaItems: {
              create: [{
                id: mediaId,
                type: 'image',
                url: mediaUrl,
                thumbnailUrl: mediaUrl,
                localPath,
                imageTags: tags.length > 0 ? JSON.stringify(tags) : null,
              }],
            },
          },
        })

        try {
          indexBookmark({
            bookmarkId: bookmark.id,
            title,
            text,
            body,
            imageTagTerms: tags.join(' '),
          })
        } catch {}

        cards.push({
          id: bookmark.id,
          title,
          status,
          extracted: Boolean(body),
          message: visionError
            ? `${name} was saved, but OCR/vision is unavailable.`
            : truncated
              ? `${name} imported with long OCR/vision text clipped for local processing.`
              : undefined,
        })
      } catch (err) {
        failures.push({
          name,
          error: err instanceof Error ? err.message : `Could not import ${name}.`,
          status: err instanceof ImageVisionError ? err.status : 500,
        })
      }
    }

    if (cards.length === 0) {
      return NextResponse.json({
        ok: false,
        error: failures[0]?.error ?? 'No images could be imported.',
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
    return NextResponse.json({ error: `Image import failed: ${String(err)}` }, { status: 500 })
  }
}

function titleFromFilename(filename: string): string {
  const withoutPath = filename.split(/[\\/]/).pop() || 'Image'
  const withoutExtension = withoutPath.replace(/\.(png|jpe?g|webp)$/i, '').trim()
  return withoutExtension || 'Image'
}

function cardTitle(title: string | null, text: string): string {
  return title || text.slice(0, 120) || 'Image'
}

function excerptForImage(text: string, title: string): string {
  const firstLine = text
    .split('\n')
    .map(line => line.replace(/^#+\s*/, '').trim())
    .find(line => line && !line.match(/^visible text|visual description|useful details|tags$/i))
  return (firstLine || title).slice(0, 280)
}
