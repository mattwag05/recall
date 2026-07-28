import { PrismaClient } from '@prisma/client'
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
const prisma = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: 'file:./dev.db' }) })
const now = Date.now()
const rows = [
  { title: 'Local-first software', text: 'Seven ideals for local-first software and CRDTs.', status: 'ready', provider: 'inkandswitch.com' },
  { title: 'The Grug Brained Developer', text: 'A layman guide to thinking like the self-aware smol brained.', status: 'ready', provider: 'grugbrain.dev' },
  { title: 'Broken capture', text: 'This one failed extraction.', status: 'failed', provider: 'example.com' },
  { title: 'Still processing', text: 'Should NOT appear in the inbox.', status: 'organizing', provider: 'example.com' },
  { title: 'Already reviewed', text: 'Should NOT appear in the inbox.', status: 'ready', provider: 'example.com', triageStatus: 'reviewed' },
]
for (const [i, r] of rows.entries()) {
  await prisma.bookmark.create({ data: {
    platform: 'web', text: r.text, title: r.title, provider: r.provider, postUrl: `https://example.com/${i}`,
    status: r.status, triageStatus: r.triageStatus ?? 'new', sourceType: 'url',
    summary: r.status === 'ready' ? `${r.title} — a short summary for triage.` : null,
    importedAt: new Date(now - i * 60000),
  }})
}
const total = await prisma.bookmark.count()
const inbox = await prisma.bookmark.count({ where: { triageStatus: 'new', status: { in: ['ready','failed'] } } })
console.log(JSON.stringify({ total, inbox }))
await prisma.$disconnect()
