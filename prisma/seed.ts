import { getPrisma } from '../lib/db'

// Recall-style general knowledge categories ("tags"), hierarchical via parent.
// Muted, warm palette to harmonize with the Reading Room aesthetic.
const parents = [
  { name: 'Technology', slug: 'technology', color: '#7b2d26' },
  { name: 'Science', slug: 'science', color: '#3f5b52' },
  { name: 'Business', slug: 'business', color: '#8a6d3b' },
  { name: 'Health', slug: 'health', color: '#6b7f54' },
  { name: 'Learning', slug: 'learning', color: '#4a5a73' },
  { name: 'Ideas', slug: 'ideas', color: '#9a5b3b' },
  { name: 'Culture', slug: 'culture', color: '#73506b' },
  { name: 'Reference', slug: 'reference', color: '#6b5d4f' },
  { name: 'General', slug: 'general', color: '#8a8175' },
]

const children: Array<{ name: string; slug: string; color: string; parent: string }> = [
  { name: 'AI & ML', slug: 'ai-ml', color: '#9a3a32', parent: 'technology' },
  { name: 'Software', slug: 'software', color: '#9a3a32', parent: 'technology' },
  { name: 'Web', slug: 'web', color: '#9a3a32', parent: 'technology' },
  { name: 'Productivity', slug: 'productivity', color: '#5a6a85', parent: 'learning' },
  { name: 'Startups', slug: 'startups', color: '#a3814a', parent: 'business' },
]

// Demo fixture data. Only used by `npm run db:seed:demo`.
//
// The plain seed creates categories and nothing else, which leaves the library,
// graph, and review surfaces rendering empty states even when cards exist. That
// makes them impossible to verify by eye. This fixture links existing cards to
// tags and mints connections and quiz questions so those surfaces have
// something real to draw.
//
// ponytail: it decorates whatever cards are already in the database rather than
// inventing any. Fabricated cards would need plausible titles, bodies, and
// thumbnails to be worth looking at, and a fixture nobody trusts is worse than
// no fixture.
const DEMO_ENTITIES = [
  { type: 'Software Application', label: 'Visual Studio Code' },
  { type: 'Software Application', label: 'Codex' },
  { type: 'Corporation', label: 'OpenAI' },
  { type: 'Corporation', label: 'Anthropic' },
  { type: 'Product', label: 'Claude' },
  { type: 'Product', label: 'ChatGPT' },
  { type: 'Web Site', label: 'GitHub' },
  { type: 'Topic', label: 'Retrieval Augmented Generation' },
]

const DEMO_ORIGIN = 'fixture'
const MEMORY_STAGES = ['new', 'learning', 'practiced', 'confident', 'mastered']

async function seedDemo() {
  const prisma = getPrisma()

  const cards = await prisma.bookmark.findMany({ orderBy: { importedAt: 'desc' } })
  if (cards.length === 0) {
    console.log('Demo fixture skipped: no cards in the database. Import something first.')
    return
  }
  const tags = await prisma.category.findMany()
  console.log(`Fixturing ${cards.length} cards against ${tags.length} tags`)

  // Two tags each, so tag-tree counts and the multi-tag filter both have
  // something to show.
  let links = 0
  for (const [i, card] of cards.entries()) {
    for (const offset of [0, 1]) {
      const tag = tags[(i * 2 + offset) % tags.length]
      await prisma.bookmarkCategory.upsert({
        where: { bookmarkId_categoryId: { bookmarkId: card.id, categoryId: tag.id } },
        update: {},
        create: { bookmarkId: card.id, categoryId: tag.id, confidence: 1 },
      })
      links++
    }
  }

  // Re-runnable: drop only what this fixture created, never real connections.
  await prisma.connection.deleteMany({ where: { origin: DEMO_ORIGIN } })

  // A ring plus a chord, so the graph has cycles and a hub rather than a line.
  let cardEdges = 0
  for (const [i, card] of cards.entries()) {
    const target = cards[(i + 1) % cards.length]
    if (target.id === card.id) continue
    await prisma.connection.create({
      data: { fromId: card.id, toId: target.id, entityType: 'Card', label: target.title ?? 'related card', origin: DEMO_ORIGIN },
    })
    cardEdges++
  }
  if (cards.length > 3) {
    await prisma.connection.create({
      data: { fromId: cards[0].id, toId: cards[2].id, entityType: 'Card', label: cards[2].title ?? 'related card', origin: DEMO_ORIGIN },
    })
    cardEdges++
  }

  // Entity connections carry `toId: null`. These are what the Connections tab
  // groups by type and what makes the graph more than just cards.
  let entityEdges = 0
  for (const [i, card] of cards.entries()) {
    for (let k = 0; k < 3; k++) {
      const entity = DEMO_ENTITIES[(i * 3 + k) % DEMO_ENTITIES.length]
      await prisma.connection.create({
        data: { fromId: card.id, toId: null, entityType: entity.type, label: entity.label, origin: DEMO_ORIGIN },
      })
      entityEdges++
    }
  }

  await prisma.quizQuestion.deleteMany({ where: { origin: DEMO_ORIGIN } })

  // Spread across overdue, today, this week, and next week so the review
  // dashboard's three due counts are all non-zero.
  const day = 86400000
  let questions = 0
  for (const [i, card] of cards.entries()) {
    for (let k = 0; k < 4; k++) {
      const n = i * 4 + k
      const mcq = k % 2 === 0
      await prisma.quizQuestion.create({
        data: {
          bookmarkId: card.id,
          prompt: `Fixture question ${n + 1} about "${(card.title ?? 'this card').slice(0, 48)}"?`,
          answer: mcq ? 'Option A' : 'A short free-text answer.',
          type: mcq ? 'mcq' : 'short',
          options: mcq ? JSON.stringify(['Option A', 'Option B', 'Option C', 'Option D']) : null,
          origin: DEMO_ORIGIN,
          memoryStage: MEMORY_STAGES[n % MEMORY_STAGES.length],
          ease: 2.5,
          intervalDays: n % 7,
          dueAt: new Date(Date.now() + (n % 5 === 0 ? -2 * day : (n % 14) * day)),
          timesSeen: n % 5,
          timesCorrect: n % 3,
        },
      })
      questions++
    }
  }

  console.log(
    `Demo fixture: ${links} card-tag links, ${cardEdges} card connections, ` +
    `${entityEdges} entity connections, ${questions} quiz questions`
  )
}

async function main() {
  const prisma = getPrisma()

  for (const cat of parents) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, color: cat.color },
      create: { ...cat, isAiGenerated: false },
    })
  }

  for (const child of children) {
    const parent = await prisma.category.findUnique({ where: { slug: child.parent } })
    if (!parent) continue
    await prisma.category.upsert({
      where: { slug: child.slug },
      update: { name: child.name, color: child.color, parentId: parent.id },
      create: {
        name: child.name,
        slug: child.slug,
        color: child.color,
        isAiGenerated: false,
        parentId: parent.id,
      },
    })
  }

  console.log(`Seeded ${parents.length} top-level + ${children.length} child categories`)

  if (process.argv.includes('--demo')) await seedDemo()
}

main().catch(console.error).finally(() => process.exit(0))
