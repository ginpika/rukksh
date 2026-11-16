import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createProject } from '../api/client'
import { listProjectWorkspaceBindings } from '../api/collaboration'
import {
  addPersonalFocus, createTodo, deletePersonalFocus, editPersonalFocus, getTodoDetail,
  savePersonalDayNote, saveTodo, startPersonalFocus, stopPersonalFocus, transitionTodo,
  type DayNote, type FocusInput, type PersonalFocus, type TodoAction, type TodoInput, type TodoItem,
} from '../api/todo'
import { AppIcon, type AppIconName } from '../components/AppIcon'
import FloatWindow from '../components/FloatWindow'
import { LoadState } from '../components/LoadState'
import { PortalAppearanceContext } from '../components/portalAppearance'
import { Select } from '../components/Select'
import { Button } from '../components/ui'
import { codingHref } from './coding/navigation'
import DailyEffort from './todo/DailyEffort'
import DayNoteForm from './todo/DayNoteForm'
import FocusEditor from './todo/FocusEditor'
import TimeAllocation from './todo/TimeAllocation'
import TodoEditor from './todo/TodoEditor'
import TodoHistory from './todo/TodoHistory'
import { TodoList } from './todo/TodoList'
import { currentMonth, isOpen, shiftMonth, todoError } from './todo/format'
import type { PersonalProjectInput } from './todo/projectModel'
import { useTodoResource } from './todo/useTodoResource'
import { useTodos } from './todo/useTodos'
import { useWorkSearchParams, workProjectsHref, workTasksHref } from './todo/workRoutes'
import { shiftDay } from './todo/workTime'
import './todo/todo.css'

type View = 'today' | 'all' | 'time' | 'review'
const VIEWS: { id: View; label: string; icon: AppIconName }[] = [
  { id: 'today', label: '今天', icon: 'clock' },
  { id: 'all', label: '全部待办', icon: 'todo' },
  { id: 'time', label: '时间分配', icon: 'stats' },
  { id: 'review', label: '月度回顾', icon: 'doc' },
]

const STATE_NOTICES: Record<TodoAction, string> = {
  complete: '已标记完成。',
  drop: '已放下此待办。',
  reopen: '已重新打开。',
}

export default function Todos() {
  const params = useWorkSearchParams()
  const project = params.get('project') ?? ''
  const detailId = params.get('todo') || null
  const [view, setView] = useState<View>(() => project ? 'all' : 'today')
  const [month, setMonth] = useState(currentMonth)
  const [selectedDay, setSelectedDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [quick, setQuick] = useState('')
  const [adding, setAdding] = useState(false)
  const [detailRevision, setDetailRevision] = useState(0)
  const [focusEditor, setFocusEditor] = useState<{ todoId: string; focus?: PersonalFocus } | null>(null)
  const [pastNote, setPastNote] = useState<DayNote | null>(null)
  const mutation = useRef(false)
  const openedDetail = useRef('')
  const data = useTodos(project, month, { review: view === 'review', day: view === 'time' ? selectedDay : null })
  const { overview, review, loading, reload } = data
  const fetchDetail = useCallback((signal: AbortSignal) => getTodoDetail(detailId ?? '', signal), [detailId])
  const detail = useTodoResource(detailId, detailRevision, fetchDetail)

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const refreshDetail = () => setDetailRevision(value => value + 1)
  const refresh = () => {
    reload()
    refreshDetail()
  }

  async function mutate<T>(work: () => Promise<T>, message = ''): Promise<T> {
    if (mutation.current) throw new Error('上一项操作尚未完成，请稍候。')
    mutation.current = true
    setBusy(true)
    setActionError(null)
    try {
      const result = await work()
      refresh()
      if (message) setNotice(message)
      return result
    } catch (error) {
      setActionError(todoError(error))
      reload()
      throw error
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }

  const selectedProject = data.projects.find(item => item.id === project)
  const bindings = useTodoResource(selectedProject ? 'project-workspaces' : null, 0, listProjectWorkspaceBindings)
  const workspace = bindings.data?.find(binding => binding.projectId === project && binding.enabled)
  const defaultProject = selectedProject?.status === 'active' ? project : ''
  const active = overview?.active
  const disabled = busy || !overview
  const isTaskView = view === 'today' || view === 'all'
  const items = overview?.items ?? []
  const open = items.filter(isOpen)
  const today = overview?.today ?? ''
  const todayItems = open.filter(item => item.plannedOn === today)
  const overdue = open.filter(item => item.plannedOn && item.plannedOn < today)
  const upcoming = open.filter(item => !item.plannedOn || item.plannedOn > today)
  const focusItems = [...new Map([
    ...items, ...(data.dayWork?.items ?? []), ...(detail.data ? [detail.data.item] : []),
  ].map(item => [item.id, item])).values()]
  const shownDay = selectedDay || today
  const projectOptions = [
    { value: '', label: '全部项目' },
    { value: 'unassigned', label: '未关联项目' },
    ...data.projects.map(item => ({ value: item.id, label: item.status === 'active' ? item.name : `${item.name}（已停用）` })),
  ]
  if (project && project !== 'unassigned' && !selectedProject) {
    projectOptions.push({ value: project, label: '项目不可用' })
  }

  const quiet = (work: Promise<unknown>) => { void work.catch(() => {}) }
  const setProject = (id: string) => { window.location.hash = workTasksHref(id) }
  const openDetail = (id: string) => {
    setAdding(false)
    const href = workTasksHref(project, id)
    if (window.location.hash === href) return
    if (detailId) {
      if (openedDetail.current === window.location.hash) openedDetail.current = href
      window.location.replace(href)
    } else {
      openedDetail.current = href
      window.location.hash = href
    }
  }
  const closeDetail = () => {
    if (busy) return
    if (openedDetail.current === window.location.hash) window.history.back()
    else window.location.replace(workTasksHref(project))
  }
  const openCreate = () => {
    if (detailId) closeDetail()
    setAdding(true)
  }
  const transition = async (item: TodoItem, action: TodoAction) => {
    await mutate(() => transitionTodo(item, action), STATE_NOTICES[action])
  }
  const save = async (input: TodoInput) => {
    if (adding) {
      const submittedFrom = window.location.hash
      const created = await mutate(() => createTodo(input), '待办已创建。')
      setAdding(false)
      setView(created.plannedOn === today ? 'today' : 'all')
      const createdScope = created.projectId ?? 'unassigned'
      if (project && project !== createdScope && window.location.hash === submittedFrom) setProject(createdScope)
    } else if (detailId) {
      await mutate(() => saveTodo(detailId, input), '待办已保存。')
    }
  }
  const plan = (item: TodoItem, plannedOn: string | null) => mutate(
    () => saveTodo(item.id, { ...item, plannedOn }),
    plannedOn ? '已安排到今天。' : '已移除计划日期。',
  )
  const start = async (item: TodoItem) => {
    await mutate(() => startPersonalFocus(item.id, active?.id ?? null), `开始计时：${item.title}`)
  }
  const pause = () => {
    if (active) quiet(mutate(() => stopPersonalFocus(active.id), '已保存专注记录。'))
  }
  const capture = async (event: FormEvent) => {
    event.preventDefault()
    if (!quick.trim()) return
    try {
      await mutate(() => createTodo({ title: quick.trim(), note: '', projectId: defaultProject || null, plannedOn: null, dueAt: null }), '待办已创建。')
      setQuick('')
      setView('all')
    } catch { /* actionError shows the failure next to the list */ }
  }
  const saveFocus = async (input: FocusInput, focus?: PersonalFocus) => {
    await mutate(() => focus ? editPersonalFocus(focus.id, input) : addPersonalFocus(input), '专注记录已保存。')
    setFocusEditor(null)
  }
  const removeFocus = async (focus: PersonalFocus) => {
    await mutate(() => deletePersonalFocus(focus), '已删除专注记录。')
    setFocusEditor(null)
  }
  const saveNote = async (note: DayNote, body: string) => {
    const result = await mutate(() => savePersonalDayNote(note, body))
    if (pastNote?.day === result.day) setPastNote(result)
    return result
  }
  const newProject = (input: PersonalProjectInput) => mutate(() => createProject(input), '项目已创建。')
  const selectDay = (day: string) => setSelectedDay(day === today ? '' : day)
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? VIEWS.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length
    const next = VIEWS[nextIndex].id
    setView(next)
    document.getElementById(`todo-tab-${next}`)?.focus()
  }
  const list = (title: string, entries: TodoItem[], empty: string, isOverdue = false) => (
    <TodoList title={title} items={entries} empty={empty} overdue={isOverdue} activeTodo={active?.todoId ?? null}
      today={today} busy={disabled} onDetail={openDetail}
      onComplete={item => quiet(transition(item, item.state === 'done' ? 'reopen' : 'complete'))}
      onStart={item => quiet(start(item))} onPause={pause}
      onPlan={item => quiet(plan(item, today))} onClearPlan={item => quiet(plan(item, null))} />
  )

  return (
    <PortalAppearanceContext value="rukksh-surface work-surface todo-portal">
      <div className="personal-todo-page">
        <div className="todo-view-bar">
          <div className="todo-view-tabs" role="tablist" aria-label="待办视图">
            {VIEWS.map((tab, index) => (
              <button key={tab.id} id={`todo-tab-${tab.id}`} type="button" role="tab" aria-controls="todo-view"
                aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1}
                onClick={() => setView(tab.id)} onKeyDown={event => tabKeys(event, index)}>
                <AppIcon name={tab.icon} />{tab.label}
                {overview && (tab.id === 'today' || tab.id === 'all') && <span>{tab.id === 'today' ? todayItems.length : open.length}</span>}
              </button>
            ))}
          </div>
          <div className="todo-actions todo-view-actions">
            <Button variant="quiet" className="todo-icon-button" disabled={busy || loading} onClick={refresh} aria-label="刷新待办" title="刷新待办"><AppIcon name="refresh" /></Button>
            <Button variant="primary" disabled={disabled} onClick={openCreate}><AppIcon name="plus" />新建待办</Button>
          </div>
        </div>

        <div id="todo-view" className="todo-view" role="tabpanel" aria-labelledby={`todo-tab-${view}`}>
          <div className="todo-view-controls">
            <div className="todo-filters">
              <AppIcon name="folder" />
              <Select label="筛选项目" value={project} onChange={setProject} disabled={disabled} size="compact" searchable
                className="todo-project-select" options={projectOptions} />
              {selectedProject && <a className="todo-project-link" href={workProjectsHref(project)} title="查看项目" aria-label="查看项目"><AppIcon name="arrow-right" /></a>}
              {workspace && <a className="todo-project-link" href={codingHref({ projectId: workspace.repositoryId, globalProjectId: project })} title="在 AI IDE 中打开项目" aria-label="在 AI IDE 中打开项目"><AppIcon name="code" /></a>}
            </div>
            {view === 'today' && overview && <time className="todo-date" dateTime={today}>
              {new Date(overview.dayStart).toLocaleDateString('zh-CN', { timeZone: overview.zone, month: 'long', day: 'numeric', weekday: 'long' })}
            </time>}
            {view === 'review' && <div className="todo-period-picker">
              <Button size="sm" className="todo-icon-button" disabled={busy} aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}><AppIcon name="chevron-left" /></Button>
              <input aria-label="回顾月份" type="month" value={month} max={currentMonth()} disabled={busy} onChange={event => { if (event.target.value) setMonth(event.target.value) }} />
              <Button size="sm" className="todo-icon-button" disabled={busy || month >= currentMonth()} aria-label="下个月" onClick={() => setMonth(shiftMonth(month, 1))}><AppIcon name="chevron-right" /></Button>
            </div>}
            {view === 'time' && <div className="todo-period-picker">
              <Button size="sm" className="todo-icon-button" disabled={busy || !shownDay || shownDay <= '1970-01-01'} aria-label="前一天" onClick={() => selectDay(shiftDay(shownDay, -1))}><AppIcon name="chevron-left" /></Button>
              <input aria-label="时间分配日期" type="date" value={shownDay} min="1970-01-01" max={today || undefined} disabled={disabled} onChange={event => selectDay(event.target.value)} />
              <Button size="sm" className="todo-icon-button" disabled={busy || !shownDay || shownDay >= today} aria-label="后一天" onClick={() => selectDay(shiftDay(shownDay, 1))}><AppIcon name="chevron-right" /></Button>
              <Button size="sm" variant="quiet" disabled={busy || !selectedDay} onClick={() => setSelectedDay('')}>今天</Button>
            </div>}
          </div>

          <LoadState loading={loading && !overview} error={data.error} hasData={!!overview} onRetry={reload} label="待办" />
          {actionError && <div className="todo-error todo-action-feedback" role="alert"><p>{actionError}</p><Button size="sm" onClick={() => { setActionError(null); refresh() }}>重新读取</Button></div>}
          {notice && <p className="todo-notice todo-action-feedback" role="status"><AppIcon name="check" />{notice}</p>}

          {overview && isTaskView && <div className="todo-columns">
            <div className="todo-primary">
              {(!project || project === 'unassigned' || defaultProject) && <form className="todo-capture" onSubmit={event => void capture(event)}>
                <AppIcon name="plus" />
                <label className="sr-only" htmlFor="todo-quick-input">快速添加待办</label>
                <input id="todo-quick-input" value={quick} onChange={event => setQuick(event.target.value)} maxLength={160}
                  placeholder="快速添加待办…" disabled={disabled} required />
                <Button type="submit" size="sm" disabled={disabled || !quick.trim()}>添加</Button>
              </form>}
              <div className="todo-task-groups">
                {view === 'today' ? <>
                  {overdue.length > 0 && list('待重新安排', overdue, '', true)}
                  {list('今天待完成', todayItems, '今天还没有安排。')}
                  {list('今天已完成', items.filter(item => item.state === 'done' && item.completedAt !== null
                    && item.completedAt >= overview.dayStart && item.completedAt < overview.dayEnd), '今天还没有完成的待办。')}
                  {upcoming.length > 0 && list('以后安排', upcoming.slice(0, 3), '')}
                </> : <>
                  {list('进行中', open.filter(item => item.state === 'doing'), '没有进行中的待办。')}
                  {list('已计划', open.filter(item => item.state === 'ready'), '没有已计划的待办。')}
                  {list('待安排', open.filter(item => item.state === 'idea'), '没有待安排的事项。')}
                </>}
              </div>
              {view === 'today' && upcoming.length > 3 && <Button className="todo-more-tasks" variant="quiet" onClick={() => setView('all')}>查看全部待办<AppIcon name="arrow-right" /></Button>}
            </div>
            <aside className="todo-support" aria-label="专注与每日记录">
              <DailyEffort overview={overview} receivedAt={data.receivedAt} project={project} busy={disabled} canBackfill={!!focusItems.length}
                onDetail={openDetail} onPause={pause} onBackfill={() => setFocusEditor({ todoId: focusItems[0]?.id ?? '' })}
                onTimeline={() => { setSelectedDay(''); setView('time') }} />
              <DayNoteForm key={overview.dayNote.day} note={overview.dayNote} busy={busy} onSave={saveNote} />
            </aside>
          </div>}
          {view === 'review' && <div className="todo-review-region" aria-busy={data.reviewLoading}>
            <LoadState loading={data.reviewLoading && !review} error={data.reviewError} hasData={!!review} onRetry={reload} label="月度回顾" />
            {review && <TodoHistory review={review} onDetail={openDetail} onNote={day => setPastNote(review.notes.find(note => note.day === day) ?? null)} />}
          </div>}
          {view === 'time' && <div className="todo-timeline-region" aria-busy={data.dayLoading}>
            <LoadState loading={data.dayLoading && !data.dayWork} error={data.dayError} hasData={!!data.dayWork} onRetry={reload} label="时间分配" />
            {data.dayWork && <TimeAllocation day={data.dayWork} receivedAt={data.dayReceivedAt} filtered={!!project} busy={disabled}
              onDetail={openDetail} onEdit={focus => setFocusEditor({ todoId: focus.todoId, focus })} />}
          </div>}
        </div>

        {!adding && detailId && detail.error && <FloatWindow title="待办读取失败" onClose={closeDetail}>
          <div className="todo-form"><p className="todo-error" role="alert">{detail.error}</p><Button onClick={refreshDetail}>重试读取</Button></div>
        </FloatWindow>}
        {!adding && detailId && detail.loading && !detail.data && <FloatWindow title="待办详情" onClose={closeDetail}><p role="status">正在读取待办…</p></FloatWindow>}
        {(adding || (detail.data && !detail.error)) && <TodoEditor key={adding ? 'new' : `${detail.data!.item.id}:${detail.data!.item.version}`}
          detail={adding ? null : detail.data} projects={data.projects} defaultProject={defaultProject} busy={busy || (!adding && detail.loading)}
          onClose={() => { if (!busy) { if (adding) setAdding(false); else closeDetail() } }}
          onSave={save} onTransition={transition} onFocus={(todoId, focus) => setFocusEditor({ todoId, focus })}
          onCreateProject={newProject} activeTodoId={active?.todoId ?? null} onStart={start} />}
        {focusEditor && <FocusEditor key={focusEditor.focus?.id ?? `new-${focusEditor.todoId}`} {...focusEditor} items={focusItems}
          busy={busy} onClose={() => { if (!busy) setFocusEditor(null) }} onSave={saveFocus} onDelete={removeFocus} />}
        {pastNote && <FloatWindow title={`${pastNote.day} · 每日记录`} onClose={() => { if (!busy) setPastNote(null) }}>
          <DayNoteForm key={pastNote.day} note={pastNote} busy={busy} onSave={saveNote} />
        </FloatWindow>}
      </div>
    </PortalAppearanceContext>
  )
}
