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
}

main().catch(console.error).finally(() => process.exit(0))
