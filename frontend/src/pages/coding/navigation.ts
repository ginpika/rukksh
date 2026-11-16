export const codingPickerHref = '#/coding?start=1'

export function codingHref({ projectId, runId, globalProjectId }: {
  projectId?: string
  runId?: string
  globalProjectId?: string
}) {
  const params = new URLSearchParams()
  if (projectId) params.set('project', projectId)
  if (runId) params.set('run', runId)
  if (globalProjectId) params.set('globalProject', globalProjectId)
  return `#/coding${params.size ? `?${params}` : ''}`
}
