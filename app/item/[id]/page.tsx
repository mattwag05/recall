import { CardDetailView } from '@/components/recall/card-detail'

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; quiz?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  return <CardDetailView id={id} initialTab={query.tab} initialQuizStart={query.quiz === 'start'} />
}
