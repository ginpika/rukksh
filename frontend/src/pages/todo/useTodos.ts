import { useCallback, useEffect, useMemo, useState } from 'react'
import { getTodoOverview, getTodoReview, getTodoDay } from '../../api/todo'
import { useTodoResource } from './useTodoResource'

const fetchOverview = (signal: AbortSignal) => getTodoOverview('', signal)

/** Current items are small and already bounded by the server; project filtering is immediate and local.
 * Historical queries remain scoped and independently cached so a filter never tears down the page. */
export function useTodos(project: string, month: string, { review: withReview = false, day = null }: { review?: boolean; day?: string | null }) {
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(v => v + 1), [])
  const fetchReview = useCallback((signal: AbortSignal) => getTodoReview(project, month, signal), [project, month])
  const fetchDay = useCallback((signal: AbortSignal) => getTodoDay(project, day ?? '', signal), [project, day])
  const base = useTodoResource('overview', revision, fetchOverview)
  const review = useTodoResource(withReview ? JSON.stringify([project, month]) : null, revision, fetchReview)
  const dayWork = useTodoResource(day === null ? null : JSON.stringify([project, day]), revision, fetchDay)
  const overview = useMemo(() => {
    if (!base.data || !project) return base.data
    const matches = (item: { projectId: string | null }) => project === 'unassigned' ? item.projectId === null : item.projectId === project
    return { ...base.data, items: base.data.items.filter(matches), todayFocus: base.data.todayFocus.filter(matches) }
  }, [base.data, project])
  useEffect(() => {
    let lastUpdate = 0
    const update = (event?: Event) => {
      if (event?.type === 'focus' && event.target !== window) return
      if (document.visibilityState !== 'visible' || performance.now() - lastUpdate < 1000) return
      lastUpdate = performance.now(); reload()
    }
    const interval = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [reload])
  return { overview, review: review.data, dayWork: dayWork.data,
    projects: base.data?.projects ?? [], loading: base.loading, error: base.error, receivedAt: base.receivedAt,
    reviewLoading: review.loading, reviewError: review.error,
    dayLoading: dayWork.loading, dayError: dayWork.error, dayReceivedAt: dayWork.receivedAt, reload }
}
