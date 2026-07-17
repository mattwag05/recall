import { NextResponse } from 'next/server'
import { getPrisma } from '@/lib/db'
import { indexBookmark } from '@/lib/fts'
import { generateNotebook, extractTldr } from '@/lib/notebook'
import { tagBookmarks } from '@/lib/semantic-tagger'
import { classifyBookmarks } from '@/lib/categorizer'
import { captureUrl } from '@/lib/url-capture'

export const runtime = 'nodejs'
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

// POST /api/cards/:id/retry — re-extract a URL card that failed, then enrich it.
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const prisma = getPrisma()
    const b = await prisma.bookmark.findUnique({
      where: { id },
      select: { id: true, postUrl: true },
    })
    if (!b) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    if (!b.postUrl) return NextResponse.json({ error: 'No source URL to retry' }, { status: 400 })

    await prisma.bookmark.update({ where: { id }, data: { status: 'organizing' } })

    const capture = await captureUrl(b.postUrl)
    if (capture.status === 'failed') {
      await prisma.bookmark.update({ where: { id }, data: { status: 'failed' } }).catch(() => {})
      return NextResponse.json({ ok: false, error: capture.message ?? 'Still no readable content' }, { status: 502 })
    }

    await prisma.bookmark.update({
      where: { id },
      data: {
        title: capture.title,
        platform: capture.platform,
        provider: capture.provider,
        text: capture.text,
        body: capture.body,
        thumbnail: capture.thumbnail,
        sourceType: capture.sourceType,
        status: 'summarizing',
        rawJson: JSON.stringify(capture.rawJson),
        embedding: null,
      },
    })
    if (capture.mediaItem) {
      await prisma.mediaItem.deleteMany({ where: { bookmarkId: id, localPath: null } }).catch(() => {})
      await prisma.mediaItem.create({
        data: {
          bookmarkId: id,
          type: capture.mediaItem.type,
          url: capture.mediaItem.url,
          thumbnailUrl: capture.mediaItem.thumbnailUrl,
        },
      }).catch(() => {})
    }
    try {
      indexBookmark({
        bookmarkId: id,
        title: capture.title,
        text: capture.text,
        body: capture.body,
      })
    } catch {}

    try {
      // Enrich this one card: notebook + TL;DR summary + tags.
      const notebookContent = await generateNotebook({ id, title: capture.title, text: capture.text, body: capture.body })
      const tldr = extractTldr(notebookContent)
      const tagsMap = await tagBookmarks([{ id, text: capture.text, title: capture.title, body: capture.body, entities: null, imageTags: null }])
      const tags = tagsMap.get(id) ?? []
      const semanticTags = JSON.stringify(tags)
      const availableCategories = await prisma.category.findMany({
        select: { id: true, slug: true, name: true, description: true },
      })
      const classifications = await classifyBookmarks([
        { id, text: capture.text, body: capture.body, postUrl: b.postUrl, semanticTags, entities: null },
      ], availableCategories)
      const classification = classifications.find(c => c.bookmarkId === id)

      if (classification) {
        for (const cat of classification.categories) {
          const category = availableCategories.find(c => c.slug === cat.categorySlug)
          if (!category) continue
          await prisma.bookmarkCategory.upsert({
            where: { bookmarkId_categoryId: { bookmarkId: id, categoryId: category.id } },
            create: { bookmarkId: id, categoryId: category.id, confidence: cat.confidence },
            update: { confidence: cat.confidence },
          })
        }
      }

      await prisma.bookmark.update({
        where: { id },
        data: {
          notebookContent,
          status: 'ready',
          embedding: null,
          semanticTags,
          ...(classification ? {
            actionability: classification.actionability,
            enrichedAt: new Date(),
            enrichmentMeta: JSON.stringify({
              enrichedAt: new Date().toISOString(),
              stages: ['retry_extraction', 'semantic_tagging', 'categorization', 'summarization'],
            }),
          } : {}),
          ...(tldr ? { summary: tldr } : {}),
        },
      })
      try {
        indexBookmark({
          bookmarkId: id,
          title: capture.title,
          text: capture.text,
          body: capture.body,
          summary: tldr,
          notebookContent,
          semanticTags,
        })
      } catch {}

      return NextResponse.json({ ok: true, categories: classification?.categories.length ?? 0 })
    } catch (err) {
      await prisma.bookmark.update({ where: { id }, data: { status: 'failed' } }).catch(() => {})
      return NextResponse.json({ ok: false, error: `Re-enrichment failed after extraction: ${String(err)}` }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: `Retry failed: ${String(err)}` }, { status: 500 })
  }
}
