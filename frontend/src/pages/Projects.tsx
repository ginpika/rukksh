import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { listProjects, createProject, updateProject, type Project } from '../api/client'
import { listProjectWorkspaceBindings, type ProjectWorkspaceBinding } from '../api/collaboration'
import { getTodoProjects, type TodoProjectSummary } from '../api/todo'
import { AppIcon, type AppIconName } from '../components/AppIcon'
import { PortalAppearanceContext } from '../components/portalAppearance'
import { collaborationHref } from './collaboration/navigation'
import { codingHref } from './coding/navigation'
import ProjectEditor from './todo/ProjectEditor'
import { duration } from './todo/format'
import { PROJECT_STATUSES, projectKind, projectStatus, type PersonalProjectInput } from './todo/projectModel'
import { useTodoResource } from './todo/useTodoResource'
import { useWorkSearchParams, workProjectsHref, workTasksHref } from './todo/workRoutes'
import './todo/todo.css'
import './todo/projects.css'

type ProjectEntry = Pick<Project, 'id' | 'name' | 'status'> & { info: Project | null }

function ProjectStatus({ status }: { status: string }) {
  return <span className="work-projects__status" data-status={status}><i aria-hidden="true" />{projectStatus(status)}</span>
}

function ProjectLink({ href, icon, label, detail }: { href: string; icon: AppIconName; label: string; detail: string }) {
  return (
    <a href={href} className="work-projects__link">
      <span className="work-projects__glyph"><AppIcon name={icon} size={18} /></span>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <AppIcon name="arrow-right" />
    </a>
  )
}

function ProjectProblem({ label, error, retry }: { label: string; error: string; retry: () => void }) {
  return (
    <div className="work-projects__problem" role="alert">
      <AppIcon name="alert" />
      <span><strong>{label}</strong><small>{error}</small></span>
      <button type="button" className="work-projects__button" onClick={retry}>重试</button>
    </div>
  )
}

export default function Projects() {
  const projectId = useWorkSearchParams().get('project') || ''
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [summaryRevision, setSummaryRevision] = useState(0)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const catalog = useTodoResource('project-catalog', catalogRevision, listProjects)
  const summaries = useTodoResource('project-summaries', summaryRevision, getTodoProjects)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState('')
  const [editor, setEditor] = useState<{ project?: Project } | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const projectEntries: ProjectEntry[] = (catalog.data ?? []).map(info => ({ id: info.id, name: info.name, status: info.status, info }))
  const ids = new Set(projectEntries.map(project => project.id))
  const historical = (summaries.data ?? []).filter(project => project.status === 'deleted' && !ids.has(project.id))
  const projects = [...projectEntries, ...historical.map(project => ({ ...project, info: null }))]
  const selected = projects.find(project => project.id === projectId)
  const summary = summaries.data?.find(project => project.id === projectId)
  const workspaces = useTodoResource(selected?.info ? 'project-workspaces' : null, workspaceRevision, listProjectWorkspaceBindings)
  const workspace = workspaces.data?.find(binding => binding.projectId === projectId)
  const retryCatalog = () => setCatalogRevision(value => value + 1)
  const retrySummaries = () => setSummaryRevision(value => value + 1)
  const retryWorkspaces = () => setWorkspaceRevision(value => value + 1)

  useLayoutEffect(() => {
    rootRef.current?.closest('.sl-page__main')?.scrollTo({ top: 0 })
  }, [projectId])

  const selectedId = selected?.id
  useLayoutEffect(() => {
    if (selectedId && document.activeElement === document.body) {
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [selectedId])

  async function saveProject(input: PersonalProjectInput) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const locationAtSave = window.location.hash
    try {
      const editing = editor?.project
      const saved = editing ? await updateProject(editing.id, input) : await createProject(input)
      setEditor(null)
      retryCatalog()
      retrySummaries()
      if (!editing && rootRef.current && window.location.hash === locationAtSave) {
        setSearch('')
        setStatus('')
        setKind('')
        window.location.hash = workProjectsHref(saved.id)
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const kinds = [...new Set((catalog.data ?? []).map(project => project.kind))]
  const statuses = [...new Set([...PROJECT_STATUSES.map(option => option.value), ...projects.map(project => project.status)])]
  const query = search.trim().toLocaleLowerCase()
  const filtered = projects.filter(project =>
    (!status || project.status === status) && (!kind || project.info?.kind === kind)
      && `${project.name} ${project.info?.note ?? ''}`.toLocaleLowerCase().includes(query),
  )
  const hasFilters = !!(query || status || kind)
  const unassigned = summaries.data?.find(project => project.id === 'unassigned')

  return (
    <div className="work-projects" ref={rootRef}>
      {catalog.error && <ProjectProblem label="无法读取项目" error={catalog.error} retry={retryCatalog} />}
      {projectId ? (
        <>
          <a className="work-projects__back" href={workProjectsHref()}><AppIcon name="chevron-left" />所有项目</a>
          {selected ? (
            <ProjectDetail
              project={selected}
              summary={summary}
              summaryState={summaries}
              workspace={workspace}
              workspaceState={workspaces}
              headingRef={headingRef}
              retrySummaries={retrySummaries}
              retryWorkspaces={retryWorkspaces}
              saving={saving}
              onEdit={project => setEditor({ project })}
            />
          ) : catalog.loading || summaries.loading ? (
            <p className="work-projects__loading" role="status">正在读取项目…</p>
          ) : catalog.data && !catalog.error && !summaries.error ? (
            <p className="work-projects__empty">找不到这个项目。</p>
          ) : summaries.error && (
            <ProjectProblem label="无法读取项目待办汇总" error={summaries.error} retry={retrySummaries} />
          )}
        </>
      ) : (
        <>
          <header className="work-projects__heading">
            <h2>所有项目</h2>
            <button type="button" className="work-projects__button work-projects__button--primary" disabled={saving} onClick={() => setEditor({})}>
              <AppIcon name="plus" />新建项目
            </button>
          </header>
          <section className="work-projects__directory" aria-labelledby="work-projects-directory-title">
            <header className="work-projects__directory-header">
              <div className="work-projects__filters">
                <label className="work-projects__search">
                  <AppIcon name="search" />
                  <span className="sr-only">搜索项目</span>
                  <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索项目名称或说明" />
                </label>
                <label className="work-projects__select">
                  <span className="sr-only">项目状态</span>
                  <select value={status} onChange={event => setStatus(event.target.value)}>
                    <option value="">全部状态</option>
                    {statuses.map(value => <option key={value} value={value}>{projectStatus(value)}</option>)}
                  </select>
                  <AppIcon name="chevron-down" size={14} />
                </label>
                <label className="work-projects__select">
                  <span className="sr-only">项目分类</span>
                  <select value={kind} onChange={event => setKind(event.target.value)}>
                    <option value="">全部分类</option>
                    {kinds.map(value => <option key={value} value={value}>{projectKind(value)}</option>)}
                  </select>
                  <AppIcon name="chevron-down" size={14} />
                </label>
              </div>
              <h3 id="work-projects-directory-title">
                {catalog.data ? `${hasFilters ? `显示 ${filtered.length} / ` : ''}${projects.length} 个项目` : '项目列表'}
              </h3>
            </header>
            {filtered.length > 0 ? (
              <ul className="work-projects__list" role="list">
                {filtered.map(project => (
                  <li key={project.id}>
                    <a className="work-projects__row" href={workProjectsHref(project.id)}>
                      <span className="work-projects__glyph"><AppIcon name="folder" size={18} /></span>
                      <span className="work-projects__name"><strong>{project.name}</strong>{project.info?.note && <small>{project.info.note}</small>}</span>
                      {project.info && <span className="work-projects__kind">{projectKind(project.info.kind)}</span>}
                      <ProjectStatus status={project.status} />
                      <AppIcon name="chevron-right" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : catalog.loading || summaries.loading ? (
              <p className="work-projects__loading" role="status">正在读取项目…</p>
            ) : catalog.data && (
              <div className="work-projects__empty">
                <AppIcon name={hasFilters ? 'search' : 'folder'} size={24} />
                <p>{hasFilters ? '没有符合条件的项目。' : '还没有项目。'}</p>
                {hasFilters && <button className="work-projects__button" type="button" onClick={() => { setSearch(''); setStatus(''); setKind('') }}>清除筛选</button>}
              </div>
            )}
          </section>
          {summaries.error && <ProjectProblem label="无法读取项目待办汇总" error={summaries.error} retry={retrySummaries} />}
          {unassigned && (unassigned.openCount + unassigned.completedCount + unassigned.droppedCount > 0) && (
            <a className="work-projects__unassigned" href={workTasksHref('unassigned')}>
              <AppIcon name="todo" /><span>未关联项目的待办</span><AppIcon name="arrow-right" />
            </a>
          )}
        </>
      )}
      <PortalAppearanceContext.Provider value="rukksh-surface work-surface todo-portal">
        {editor && <ProjectEditor key={editor.project?.id ?? 'new'} project={editor.project} busy={saving} onClose={() => setEditor(null)} onSave={saveProject} />}
      </PortalAppearanceContext.Provider>
    </div>
  )
}

type ResourceState = { loading: boolean; error: string | null }

function ProjectDetail({ project, summary, summaryState, workspace, workspaceState, headingRef, retrySummaries, retryWorkspaces, saving, onEdit }: {
  project: ProjectEntry
  summary?: TodoProjectSummary
  summaryState: ResourceState
  workspace?: ProjectWorkspaceBinding
  workspaceState: ResourceState
  headingRef: RefObject<HTMLHeadingElement | null>
  retrySummaries: () => void
  retryWorkspaces: () => void
  saving: boolean
  onEdit: (project: Project) => void
}) {
  const { id, info } = project
  const collaboration = `#${collaborationHref({ projectId: id, taskId: null, issueId: null })}`
  const coding = workspace?.enabled
    ? codingHref({ projectId: workspace.repositoryId, globalProjectId: id })
    : `#${collaborationHref({ projectId: id, taskId: null, issueId: null, configureWorkspace: true })}`
  const codingLabel = workspace?.enabled ? 'AI IDE' : workspace ? '调整工作目录' : '绑定工作目录'
  const directory = workspace?.enabled ? `${workspace.workspaceName} / ${workspace.directory ?? '.'}`
    : workspace ? '当前目录不可用，前往协作调整' : '在协作中设置 AI IDE 工作目录'
  const date = (value: number) => new Date(value).toLocaleDateString('zh-CN')

  return (
    <>
      <header className="work-projects__heading work-projects__heading--detail">
        <div className="work-projects__identity">
          <span className="work-projects__glyph"><AppIcon name="folder" size={24} /></span>
          <div>
            <h2 ref={headingRef} tabIndex={-1}>{project.name}</h2>
            <div className="work-projects__meta"><ProjectStatus status={project.status} />{info && <span>{projectKind(info.kind)}</span>}</div>
          </div>
        </div>
        {info && <button type="button" className="work-projects__button" disabled={saving} onClick={() => onEdit(info)}><AppIcon name="edit" />编辑项目</button>}
      </header>
      {info?.note && <p className="work-projects__description">{info.note}</p>}
      {!info && <p className="work-projects__description">项目已删除，仍可查看关联的待办和投入记录。</p>}
      <div className="work-projects__detail-grid">
        <section className="work-projects__panel" aria-labelledby="work-projects-links-title">
          <h3 id="work-projects-links-title">工作入口</h3>
          <div className="work-projects__links">
            {info && <ProjectLink href={collaboration} icon="table" label="协作" detail="成员、会话与项目资料" />}
            {info && (workspaceState.error ? (
              <ProjectProblem label="无法读取 AI IDE 工作目录" error={workspaceState.error} retry={retryWorkspaces} />
            ) : workspaceState.loading && !workspace ? (
              <p className="work-projects__loading" role="status">正在读取 AI IDE 工作目录…</p>
            ) : <ProjectLink href={coding} icon="code" label={codingLabel} detail={directory} />)}
            <ProjectLink href={workTasksHref(id)} icon="todo" label="项目待办" detail={summary ? `${summary.openCount} 件待处理` : '查看关联的个人待办'} />
          </div>
        </section>
        <section className="work-projects__panel" aria-labelledby="work-projects-summary-title">
          <h3 id="work-projects-summary-title">个人投入</h3>
          {summaryState.error && <ProjectProblem label="无法读取待办汇总" error={summaryState.error} retry={retrySummaries} />}
          {summary && <dl className="work-projects__stats">
            <div><dt>累计投入</dt><dd>{duration(summary.spentMillis)}</dd></div>
            <div><dt>进行中</dt><dd>{summary.doingCount}</dd></div>
            <div><dt>已完成</dt><dd>{summary.completedCount}</dd></div>
            <div><dt>已放下</dt><dd>{summary.droppedCount}</dd></div>
          </dl>}
          {!summary && !summaryState.error && <p className="work-projects__loading" role="status">{summaryState.loading ? '正在读取投入记录…' : '暂无个人投入记录。'}</p>}
        </section>
      </div>
      {info && <dl className="work-projects__dates">
        <div><dt>创建时间</dt><dd>{date(info.createdAt)}</dd></div>
        <div><dt>最近更新</dt><dd>{date(info.updatedAt)}</dd></div>
      </dl>}
    </>
  )
}
