import type { ArchiveListPage, SavedWorkoutDetail } from '../../../src/shared/mobile'

export interface SavedArchiveClient {
  readonly label: string
  list(): Promise<ArchiveListPage>
  detail(savedWorkoutId: string): Promise<SavedWorkoutDetail>
}

const result = async <A>(response: Response): Promise<A> => {
  const body = await response.json() as A & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Local archive request failed (${response.status})`)
  return body
}

export const createRecoveredArchiveClient = (): SavedArchiveClient => ({
  label: 'Recovered iPhone storage · read-only',
  list: () => fetch('/__workout/recovered-archive/list').then(result<ArchiveListPage>),
  async detail(id) {
    const load = (after: number | null) => fetch(`/__workout/recovered-archive/detail?id=${encodeURIComponent(id)}${after === null ? '' : `&after=${after}`}&limit=200`).then(result<SavedWorkoutDetail>)
    const first = await load(null)
    const items = [...first.observations.items]
    let page = first.observations
    while (page.hasMore) {
      if (page.nextSequence === null || page.nextSequence === page.afterSequence) throw new Error('Recovered archive cursor did not advance')
      const next = await load(page.nextSequence)
      if (next.summary.savedWorkoutId !== first.summary.savedWorkoutId || next.summary.latestSequence !== first.summary.latestSequence) throw new Error('Recovered workout changed while loading')
      items.push(...next.observations.items); page = next.observations
    }
    return { ...first, observations: { ...page, afterSequence: null, items } }
  },
})
