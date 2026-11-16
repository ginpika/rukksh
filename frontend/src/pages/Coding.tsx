import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { getSettings, type ModelView } from '../api/client'
import { codingCapabilities, codingError, codingProjects, codingRuns, codingSessions, codingWorkspaces, removeRecentCodingProject, type CodingCapabilities, type CodingMode, type CodingProject, type CodingRun, type CodingSession, type CodingWorkspace } from '../api/coding'
import { BRAND } from '../branding'
import { AppIcon } from '../components/AppIcon'
import { PortalAppearanceContext } from '../components/portalAppearance'
import { routeFromHash } from '../shell/routes'
import CodingAgentProfileLink from './coding/CodingAgentProfileLink'
import CodingProjectPicker from './coding/CodingProjectPicker'
import CodingProjectTab, { CodingProjectTabPanel, type ProjectPickerContent } from './coding/CodingProjectTab'
import CodingStudio from './coding/CodingStudio'
import CodingToolbar from './coding/CodingToolbar'
import { codingHref } from './coding/navigation'
import { readCodingProject, rememberCodingProject, resolveCodingProject } from './coding/projectSession'
import './coding.css'
import './coding/studio.css'

function routeParams() { return new URLSearchParams(window.location.hash.split('?')[1] || '') }

function EmptyCodingStudio({ renderProjectPicker, agent, showAgent }: {
  renderProjectPicker: ProjectPickerContent
  agent?: CodingCapabilities['agent']
  showAgent: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(true)
  const openButton = useRef<HTMLButtonElement>(null)
  const moveFocus = useRef(false)
  const id = useId()
  useLayoutEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    const target = pickerOpen ? document.getElementById(id) : openButton.current
    target?.focus({ preventScroll: true })
  }, [id, pickerOpen])
  return (
    <div className={`coding-studio coding-empty-studio${pickerOpen ? ' is-choosing-project' : ''}`}>
      <CodingToolbar actions={<>
        {showAgent && <CodingAgentProfileLink agent={agent} />}
        <a className="coding-toolbar-icon" href="#/workspace" aria-label="管理工作空间" title="管理工作空间">
          <AppIcon name="workspace" />
        </a>
      </>} />
      <div className="coding-studio-body">
        <aside className="coding-explorer" aria-labelledby={`${id}-explorer`}>
          <div className="coding-empty-explorer-heading">
            <AppIcon name="folder" size={16} />
            <h2 id={`${id}-explorer`}>资源管理器</h2>
          </div>
          <div className="coding-empty-explorer-actions">
            <button ref={openButton} type="button" className="coding-picker-button" aria-controls={pickerOpen ? `${id}-panel` : undefined} onClick={() => {
              if (pickerOpen) document.getElementById(id)?.focus({ preventScroll: true })
              else { moveFocus.current = true; setPickerOpen(true) }
            }}>
              <AppIcon name="folder-open" size={16} />打开文件夹
            </button>
          </div>
        </aside>
        <main className="coding-editor" aria-label="编辑器">
          <div className="coding-editor-tabs" role="group" aria-label="编辑器标签">
            {pickerOpen && <CodingProjectTab id={id} onClose={() => { moveFocus.current = true; setPickerOpen(false) }} />}
          </div>
          {pickerOpen && <CodingProjectTabPanel id={id}>{renderProjectPicker}</CodingProjectTabPanel>}
        </main>
      </div>
    </div>
  )
}

export default function Coding() {
  const [params, setParams] = useState(routeParams)
  const [rememberedProject, setRememberedProject] = useState(readCodingProject)
  const [pickerOpen, setPickerOpen] = useState(false)
  const closeProjectPicker = useCallback(() => setPickerOpen(false), [])
  const [projects, setProjects] = useState<CodingProject[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [workspaces, setWorkspaces] = useState<CodingWorkspace[]>([])
  const [runs, setRuns] = useState<CodingRun[]>([])
  const [sessions, setSessions] = useState<CodingSession[]>([])
  const [models, setModels] = useState<ModelView[]>([])
  const [caps, setCaps] = useState<CodingCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<{ projectId: string; input: string; mode: CodingMode } | null>(null)
  const load = useCallback(async () => {
    setError('')
    const result = await Promise.allSettled([codingProjects(), codingWorkspaces(), codingRuns(), getSettings(), codingCapabilities(), codingSessions()] as const)
    const [p, w, r, settings, capabilities, conversations] = result
    setProjectsLoaded(p.status === 'fulfilled')
    if (p.status === 'fulfilled') setProjects(p.value)
    if (w.status === 'fulfilled') setWorkspaces(w.value)
    if (r.status === 'fulfilled') setRuns(r.value)
    if (conversations.status === 'fulfilled') setSessions([...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt))
    if (settings.status === 'fulfilled') setModels(settings.value.models)
    if (capabilities.status === 'fulfilled') setCaps(capabilities.value)
    const names = ['项目', '工作空间', '任务', '模型设置', '模块状态', '会话']
    setError(result.flatMap((item, i) => item.status === 'rejected' ? [`${names[i]}加载失败：${codingError(item.reason)}`] : []).join('；'))
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const previousTitle = document.title
    document.title = `AI IDE · ${BRAND.name}`
    return () => { document.title = previousTitle }
  }, [])
  useEffect(() => {
    const change = () => { setParams(routeParams()); setRememberedProject(readCodingProject()) }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const runId = params.get('run') || ''
  const requestedGlobalProject = params.get('globalProject') || ''
  const selectingProject = params.has('start')
  const workspaceId = params.get('workspace') || ''
  const directory = params.get('directory') || '.'
  const explicitProject = params.has('project') || params.has('run')
  const projectId = resolveCodingProject(params, runs, rememberedProject)
  const project = projects.find(item => item.id === projectId && (explicitProject || item.enabled))
  const isCurrentRoute = () => routeFromHash(window.location.hash) === '/coding' && routeParams().toString() === params.toString()
  useLayoutEffect(() => { setPickerOpen(false) }, [project?.id, selectingProject, workspaceId, directory])
  useEffect(() => {
    if (!loading && project?.enabled && !project.recentHidden && caps) rememberCodingProject(project.id)
  }, [loading, project, caps])
  useEffect(() => {
    if (loading || !projectsLoaded) return
    const remembered = readCodingProject()
    if (remembered && !projects.some(item => item.id === remembered && item.enabled)) rememberCodingProject('')
  }, [loading, projectsLoaded, projects])
  const open = (item: CodingProject) => {
    const currentParams = routeParams()
    if (routeFromHash(window.location.hash) !== '/coding') return
    if (project ? resolveCodingProject(currentParams, runs, rememberedProject) !== project.id : currentParams.toString() !== params.toString()) return
    setPickerOpen(false)
    setProjects(previous => [item, ...previous.filter(p => p.id !== item.id)])
    if (item.id === project?.id) return
    setDraft(null)
    window.location.hash = codingHref({ projectId: item.id })
  }
  const removeRecent = async (item: CodingProject) => {
    await removeRecentCodingProject(item.id)
    if (readCodingProject() === item.id) rememberCodingProject('')
    setProjects(previous => previous.map(project => project.id === item.id ? { ...project, recentHidden: true } : project))
  }
  const changed = useCallback((run: CodingRun) => {
    setRuns(previous => {
      const existing = previous.find(item => item.id === run.id)
      if (existing && existing.updatedAt > run.updatedAt) return previous
      const next = existing ? previous.map(item => item.id === run.id ? run : item) : [run, ...previous]
      return next.sort((a, b) => b.updatedAt - a.updatedAt)
    })
    if (run.sessionId) setSessions(previous => {
      const existing = previous.find(item => item.id === run.sessionId)
      if (existing && existing.updatedAt > run.updatedAt) return previous
      const next = { id: run.sessionId!, repositoryId: run.repositoryId, title: existing?.title || run.prompt, lastRunId: run.id, createdAt: existing?.createdAt ?? run.createdAt, updatedAt: run.updatedAt }
      // 先原位合并，再按真实更新时间降序；相同时间保持既有顺序。
      const items = existing ? previous.map(item => item.id === next.id ? next : item) : [next, ...previous]
      return items.sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }, [])
  const projectError = !loading && !project && explicitProject ? '找不到编程项目，请选择要打开的项目或工作空间目录。' : ''
  const renderProjectPicker: ProjectPickerContent = menuHost => <CodingProjectPicker
    key={JSON.stringify([workspaceId, directory])}
    projects={projects.filter(item => !item.recentHidden)}
    workspaces={workspaces}
    runs={runs}
    activeProjectId={project?.id}
    initialWorkspace={workspaceId}
    initialDirectory={directory}
    loading={loading}
    menuHost={menuHost}
    enabled={caps?.enabled === true}
    error={error || projectError}
    onOpen={open}
    onRemoveRecent={removeRecent}
    onReload={load}
  />
  return (
    <PortalAppearanceContext.Provider value="coding-popover rukksh-surface">
      <div data-page="coding" className="coding-page rukksh-surface">
        {project && caps ? <CodingStudio
          key={project.id}
          project={project}
          requestedGlobalProject={requestedGlobalProject}
          models={models}
          caps={caps}
          runs={runs.filter(r => r.repositoryId === project.id)}
          sessions={sessions.filter(s => s.repositoryId === project.id)}
          runId={runId}
          onRunChanged={changed}
          initialDraft={draft?.projectId === project.id ? draft : undefined}
          loadError={error}
          onReload={load}
          onChooseProject={() => setPickerOpen(true)}
          onCloseProjectPicker={closeProjectPicker}
          projectPicker={pickerOpen ? renderProjectPicker : undefined}
          onSelectRun={(id, seed) => {
            if (!isCurrentRoute()) return
            setDraft(seed ? { ...seed, projectId: project.id } : null)
            window.location.hash = codingHref({ projectId: project.id, runId: id, globalProjectId: requestedGlobalProject })
          }}
        /> : <EmptyCodingStudio key={JSON.stringify([selectingProject, workspaceId, directory])}
          showAgent={!!caps} agent={caps?.agent} renderProjectPicker={renderProjectPicker} />}
      </div>
    </PortalAppearanceContext.Provider>
  )
}
