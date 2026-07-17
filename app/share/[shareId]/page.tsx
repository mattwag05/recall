import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPrisma } from '@/lib/db'
import { renderMarkdown, renderReader } from '@/lib/markdown-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ shareId: string }> }

// Public link metadata: tab/preview title is the shared card's own title.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shareId } = await params
  const card = await getPrisma().bookmark.findFirst({
    where: { shareId, shared: true },
    select: { title: true, text: true, summary: true },
  })
  if (!card) return { title: 'Not found · Recall' }
  const title = card.title || card.text.slice(0, 120) || 'Shared card'
  return {
    title: `${title} · Recall`,
    description: card.summary || undefined,
    robots: { index: false },
  }
}

// Read-only public view of a shared card. Resolves only when shared === true,
// so revoking a share (DELETE clears shareId) makes the link 404.
export default async function SharedCardPage({ params }: Params) {
  const { shareId } = await params
  const card = await getPrisma().bookmark.findFirst({
    where: { shareId, shared: true },
    select: { title: true, text: true, provider: true, postUrl: true, summary: true, notebookContent: true, body: true, updatedAt: true },
  })
  if (!card) notFound()

  const title = card.title || card.text.slice(0, 120) || 'Untitled'
  const notebook = card.notebookContent?.trim() ?? ''
  const reader = card.body?.trim() ?? ''

  return (
    <div className="mx-auto max-w-3xl px-6 md:px-10 pb-24">
      <header className="flex flex-col gap-2 pt-10 pb-5 rr-rule">
        <p className="rr-mono" style={{ color: 'var(--accent)' }}>Shared from Recall · read-only</p>
        <h1 className="font-display" style={{ fontSize: '2.2rem', fontWeight: 500, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {card.postUrl
            ? <a href={card.postUrl} target="_blank" rel="noreferrer" className="rr-mono rr-link" style={{ color: 'var(--accent)', overflowWrap: 'anywhere' }}>{card.provider ?? 'source'} ↗</a>
            : <span className="rr-mono">{card.provider ?? 'note'}</span>}
        </div>
      </header>

      {notebook ? (
        <article className="rr-prose pt-6" dangerouslySetInnerHTML={{ __html: renderMarkdown(notebook) }} />
      ) : card.summary ? (
        <p className="rr-prose pt-6">{card.summary}</p>
      ) : reader ? (
        <article className="rr-prose pt-6" dangerouslySetInnerHTML={{ __html: renderReader(reader) }} />
      ) : (
        <p className="rr-prose pt-6" style={{ color: 'var(--sepia)' }}>This shared card has no readable content yet.</p>
      )}

      <footer className="mt-10 pt-5 rr-rule">
        <Link href="/items" className="rr-mono rr-link">Recall</Link>
      </footer>
    </div>
  )
}
