import { useState, type ReactNode } from 'react'
import { listProjects } from '../api/client'
import { getTodoOverview, type TodoItem, type TodoOverview } from '../api/todo'
import { AppIcon, type AppIconName } from '../components/AppIcon'
import { codingPickerHref } from './coding/navigation'
import { dayLabel, isOpen } from './todo/format'
import { projectKind, projectStatus } from './todo/projectModel'
import { useTodoResource } from './todo/useTodoResource'
import { workProjectsHref, workTasksHref } from './todo/workRoutes'
import './dashboard.css'
import './todo/workHome.css'

const PREVIEW_COUNT = 4
const loadTodos = (signal: AbortSignal) => getTodoOverview('', signal)
const shortcuts: { label: string; icon: AppIconName; href: string }[] = [
  { label: '项目', icon: 'folder-open', href: workProjectsHref() },
  { label: '待办', icon: 'todo', href: workTasksHref() },
  { label: 'AI IDE', icon: 'code', href: codingPickerHref },
]

function taskPriority(item: TodoItem, overview: TodoOverview) {
  if (overview.active?.todoId === item.id) return 0
  if (item.dueAt !== null && item.dueAt < overview.dayEnd) return 1
  if (item.plannedOn && item.plannedOn <= overview.today) return 2
  return item.state === 'doing' ? 3 : 4
}

function taskMeta(item: TodoItem, overview: TodoOverview) {
  if (overview.active?.todoId === item.id) return '计时中'
  if (item.dueAt !== null) return `${dayLabel(item.dueAt)} 截止`
  if (item.plannedOn === overview.today) return '今天计划'
  if (item.plannedOn) return `计划 ${item.plannedOn}`
  return item.state === 'doing' ? '进行中' : '待安排'
}

function WorkSection({ title, count, loading, error, onRetry, empty, children }: {
  title: string
  count: number | null
  loading: boolean
  error: string | null
  onRetry: () => void
  empty: string
  children?: ReactNode
}) {
  return (
    <section className="work-entry__section" aria-label={title} aria-busy={loading}>
      <header className="work-entry__preview-heading">
        <h2>{title}</h2>
        {count !== null && <span className="work-entry__count"><span className="sr-only">共 </span>{count}<span className="sr-only"> 项</span></span>}
      </header>
      {error && (
        <div className="work-entry__state" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}
      {count === null && loading && <p className="work-entry__state" role="status">正在读取…</p>}
      {count === 0 && <p className="work-entry__state">{empty}</p>}
      {count !== null && count > 0 && <ul className="work-entry__items" role="list">{children}</ul>}
    </section>
  )
}

export default function WorkHome() {
  const [projectRevision, setProjectRevision] = useState(0)
  const [todoRevision, setTodoRevision] = useState(0)
  const projects = useTodoResource('work-projects', projectRevision, listProjects)
  const todos = useTodoResource('work-todos', todoRevision, loadTodos)
  const overview = todos.data
  const recentProjects = projects.data?.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, PREVIEW_COUNT) ?? []
  const openTasks = overview?.items.filter(isOpen) ?? []
  const nextTasks = overview ? openTasks.toSorted((a, b) => (
    taskPriority(a, overview) - taskPriority(b, overview)
    || (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER)
    || b.updatedAt - a.updatedAt
  )).slice(0, PREVIEW_COUNT) : []

  return (
    <div className="work-entry" data-page="work-home">
      <nav className="work-entry__nav" aria-label="工作入口">
        <ul className="dash-grid" role="list">
          {shortcuts.map(({ label, icon, href }) => (
            <li key={href}>
              <a className="dash-tool" href={href}>
                <span className="dash-tool__icon"><AppIcon name={icon} size={24} /></span>
                <span>{label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="work-entry__previews">
        <WorkSection
          title="最近更新的项目"
          count={projects.data?.length ?? null}
          loading={projects.loading}
          error={projects.error}
          onRetry={() => setProjectRevision(value => value + 1)}
          empty="还没有项目。"
        >
          {recentProjects.map(project => (
            <li key={project.id}>
              <a className="work-entry__row" href={workProjectsHref(project.id)}>
                <AppIcon name="folder" />
                <span className="work-entry__name">{project.name}</span>
                <span className="work-entry__meta">{project.status === 'active' ? projectKind(project.kind) : projectStatus(project.status)}</span>
              </a>
            </li>
          ))}
        </WorkSection>
        <WorkSection
          title="待处理事项"
          count={overview ? openTasks.length : null}
          loading={todos.loading}
          error={todos.error}
          onRetry={() => setTodoRevision(value => value + 1)}
          empty="暂无待处理事项。"
        >
          {overview && nextTasks.map(item => (
            <li key={item.id}>
              <a className="work-entry__row" href={workTasksHref(item.projectId ?? undefined, item.id)} data-active={overview.active?.todoId === item.id || undefined}>
                <AppIcon name={overview.active?.todoId === item.id ? 'clock' : 'square'} />
                <span className="work-entry__name">{item.title}</span>
                <span className="work-entry__meta">{taskMeta(item, overview)}</span>
              </a>
            </li>
          ))}
        </WorkSection>
      </div>
    </div>
  )
}
