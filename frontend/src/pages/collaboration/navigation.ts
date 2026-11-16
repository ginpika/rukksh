import { useEffect, useState } from 'react'

export type CollaborationLocation = { projectId: string; taskId: string | null; issueId: string | null; configureWorkspace?: boolean }
export function readCollaborationLocation(): CollaborationLocation {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const projectId = params.get('project') || ''
  const taskId = params.get('task')
  return { projectId, taskId, issueId: params.get('issue'), configureWorkspace: !!projectId && !taskId && params.get('configure') === 'workspace' }
}
export function collaborationHref(location: CollaborationLocation) {
  const params = new URLSearchParams()
  if (location.projectId) params.set('project', location.projectId)
  if (location.taskId) params.set('task', location.taskId)
  if (location.issueId && location.taskId) params.set('issue', location.issueId)
  if (location.projectId && !location.taskId && location.configureWorkspace) params.set('configure', 'workspace')
  return '/collaboration' + (params.size ? '?' + params.toString() : '')
}
export function useCollaborationNavigation() {
  const [location, setLocation] = useState(readCollaborationLocation)
  useEffect(() => {
    const changed = () => setLocation(readCollaborationLocation())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  return { location, navigate: (next: CollaborationLocation) => { window.location.hash = collaborationHref(next) } }
}
