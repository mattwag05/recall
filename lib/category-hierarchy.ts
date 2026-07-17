import type { PrismaClient } from '@prisma/client'

export type CategoryHierarchyRow = {
  id: string
  slug: string
  parentId: string | null
}

export function collectCategorySubtreeSlugs(
  categories: CategoryHierarchyRow[],
  rootSlug: string
): string[] {
  const root = categories.find(category => category.slug === rootSlug)
  if (!root) return []

  const childrenByParent = new Map<string | null, CategoryHierarchyRow[]>()
  for (const category of categories) {
    const children = childrenByParent.get(category.parentId) ?? []
    children.push(category)
    childrenByParent.set(category.parentId, children)
  }

  const slugs: string[] = []
  const seen = new Set<string>()
  const stack = [root]

  while (stack.length > 0) {
    const category = stack.pop()!
    if (seen.has(category.id)) continue
    seen.add(category.id)
    slugs.push(category.slug)
    stack.push(...(childrenByParent.get(category.id) ?? []))
  }

  return slugs
}

export async function getCategorySubtreeSlugs(
  prisma: PrismaClient,
  rootSlug: string
): Promise<string[]> {
  const categories = await prisma.category.findMany({
    select: {
      id: true,
      slug: true,
      parentId: true,
    },
  })

  return collectCategorySubtreeSlugs(categories, rootSlug)
}
