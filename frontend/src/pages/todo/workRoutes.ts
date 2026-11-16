import { useEffect, useState } from 'react'

function readWorkSearchParams() {
  const [, query] = window.location.hash.split('?', 2)
  return new URLSearchParams(query)
}

export function useWorkSearchParams() {
  const [params, setParams] = useState(readWorkSearchParams)
  useEffect(() => {
    const onHashChange = () => setParams(readWorkSearchParams())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return params
}

export function workProjectsHref(projectId?: string) {
  return projectId ? `#/todos/projects?${new URLSearchParams({ project: projectId })}` : '#/todos/projects'
}

export function workTasksHref(projectId?: string, todoId?: string) {
  const params = new URLSearchParams()
  if (projectId) params.set('project', projectId)
  if (todoId) params.set('todo', todoId)
  return params.size ? `#/todos/tasks?${params}` : '#/todos/tasks'
}
