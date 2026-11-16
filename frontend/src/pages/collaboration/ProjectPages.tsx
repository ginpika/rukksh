import { useEffect, useState } from 'react'
import { createProject, updateProject, type MaPeer, type MaSession, type Project } from '../../api/client'
import { saveCollaborationMembers } from '../../api/collaboration'
import { AppIcon } from '../../components/AppIcon'
import PeerAvatar from '../../components/PeerAvatar'
import CollaborationDialog from './CollaborationDialog'
import ProjectWorkspaceDialog from './ProjectWorkspaceDialog'
import ProjectWorkspaceStatus from './ProjectWorkspaceStatus'
import TaskActions from './TaskActions'
import ProjectKnowledge from './ProjectKnowledge'
import type { CollaborationPlan, ProjectWorkspaceBinding } from '../../api/collaboration'
import { projectStatus } from '../todo/projectModel'
import { workProjectsHref } from '../todo/workRoutes'
import { readCollaborationLocation } from './navigation'
import { projectMemberIds } from './model'

function date(value: number | null) { const d = value ? new Date(value) : null; return d && Number.isFinite(+d) ? d.toLocaleDateString('zh-CN') : '' }
const projectTabs = [
  { id: 'sessions', label: '当前推进', icon: 'chat' },
  { id: 'knowledge', label: '成果与进度', icon: 'doc' },
  { id: 'settings', label: '项目设置', icon: 'sliders' },
] as const
type ProjectTab = typeof projectTabs[number]['id']
function currentProjectTab(): ProjectTab {
  const section = new URLSearchParams(window.location.hash.split('?')[1] || '').get('section')
  return projectTabs.find(tab => tab.id === section)?.id || 'sessions'
}

export default function ProjectPages({ projectId, projects, sessions, peers, configuredMembers, workspaceBindings = [], archivedTasks = [], plans = [], runningSessions, loading, error, onProject, onTask, onNewTask, onReload }: {
  projectId: string; projects: Project[]; sessions: MaSession[]; peers: MaPeer[]; configuredMembers: Record<string, string[]>
  runningSessions: string[]; loading: boolean; error: string | null
  workspaceBindings?: ProjectWorkspaceBinding[]; archivedTasks?: string[]; plans?: CollaborationPlan[]
  onProject: (id: string) => void; onTask: (session: MaSession) => void; onNewTask: () => void; onReload: () => Promise<void>
}) {
  const [editor, setEditor] = useState<'create' | 'direction' | 'members' | 'workspace' | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [activeTab, setActiveTab] = useState(currentProjectTab)
  const [configureWorkspace, setConfigureWorkspace] = useState(() => readCollaborationLocation().configureWorkspace)
  const project = projects.find(p => p.id === projectId)
  const allTasks = sessions.filter(s => (s.projectId || '') === projectId)
  const activeCount = allTasks.filter(s => runningSessions.includes(s.id)).length
  const workspaceBusy = activeCount > 0
  const workspace = workspaceBindings.find(binding => binding.projectId === projectId)
  const tasks = allTasks.filter(s => archivedTasks.includes(s.id) === showArchived)
  const query = search.trim().toLocaleLowerCase()
  const visibleProjects = projects.filter(p => `${p.name} ${p.note || ''}`.toLocaleLowerCase().includes(query))
  const taskState = (session: MaSession) => {
    const plan = plans.find(p => p.sessionId === session.id)
    if (showArchived) return { kind: 'archived', label: '已归档' }
    if (runningSessions.includes(session.id)) return { kind: 'active', label: '正在推进' }
    if (session.topicStatus === 'waiting') return { kind: 'waiting', label: '等待你回应' }
    if (plan?.phase === 'completed') return { kind: 'completed', label: '已确认交付' }
    if (plan?.continuationStatus === 'paused') return { kind: 'paused', label: '已暂停' }
    return null
  }
  const archiveToggle = (
    <button type="button" className="ui-btn ui-btn--outline" aria-pressed={showArchived} onClick={() => setShowArchived(v => !v)}>
      <AppIcon name={showArchived ? 'chat' : 'archive'} />
      {showArchived ? '返回当前会话' : '已归档会话'}
      {!showArchived && <span className="collab-count">{allTasks.filter(s => archivedTasks.includes(s.id)).length}</span>}
    </button>
  )
  const taskRows = tasks.map(session => {
    const title = session.title || '未命名会话'
    const state = taskState(session)
    const updated = date(session.updatedAt || session.createdAt)
    return (
      <div className="collab-task-entry" key={session.id}>
        <button type="button" className="collab-task-row" onClick={() => onTask(session)}>
          <AppIcon name={showArchived ? 'archive' : 'chat'} />
          <span className="collab-task-text"><strong>{title}</strong><small>{session.memberIds.length} 位参与成员{updated && ` · ${updated}`}</small></span>
          {state && <span className="collab-task-state" data-state={state.kind}>{state.label}</span>}
          <AppIcon name="chevron-right" />
        </button>
        <TaskActions compact id={session.id} title={title} archived={showArchived} busy={runningSessions.includes(session.id)} onChanged={onReload} />
      </div>
    )
  })
  const ids = projectMemberIds(projectId, configuredMembers, sessions, peers)
  const members = peers.filter(p => ids.includes(p.id))
  const selectTab = (tab: ProjectTab) => {
    setActiveTab(tab)
    const [path, query = ''] = window.location.hash.split('?')
    const params = new URLSearchParams(query)
    params.set('section', tab)
    window.history.replaceState(null, '', `${path}?${params}`)
  }
  useEffect(() => {
    const syncTab = () => {
      setActiveTab(currentProjectTab())
      setConfigureWorkspace(readCollaborationLocation().configureWorkspace)
    }
    window.addEventListener('hashchange', syncTab)
    return () => window.removeEventListener('hashchange', syncTab)
  }, [])
  const closeWorkspace = () => {
    setEditor(null)
    setConfigureWorkspace(false)
    const [path, query = ''] = window.location.hash.split('?')
    const params = new URLSearchParams(query)
    if (params.get('project') !== projectId || params.get('configure') !== 'workspace') return
    params.delete('configure')
    window.history.replaceState(null, '', `${path}?${params}`)
  }
  return (
    <div className="collab-project-page scrollbar-slim">
      <div className="collab-page-body">
        <div className="collab-project-toolbar">
          <nav className="collab-project-links" aria-label="相关页面">
            <a className="ui-btn ui-btn--quiet" href={workProjectsHref(project?.id)}><AppIcon name="folder" />{project ? '项目详情' : '项目目录'}</a>
            <a className="ui-btn ui-btn--quiet" href="#/multi-agent"><AppIcon name="table" />管理智能体</a>
          </nav>
          <button type="button" className="ui-btn ui-btn--primary" disabled={loading || (!!projectId && !project)} onClick={() => projectId ? onNewTask() : setEditor('create')}>
            <AppIcon name="plus" />{projectId ? '新建会话' : '新建项目'}
          </button>
        </div>
        {error && <div className="collab-error" role="alert"><span>{error}</span><button className="ui-btn ui-btn--outline" onClick={() => void onReload()}>重试</button></div>}
        {loading ? <div className="collab-loading" role="status"><AppIcon name="loading" className="motion-safe:animate-spin" />正在载入项目…<div className="collab-skeleton" /><div className="collab-skeleton collab-skeleton--short" /></div> : !projectId ? <>
          <div className="collab-list-heading">
            <h2>所有项目 <span className="collab-count">{projects.length}</span></h2>
            <label className="collab-search"><AppIcon name="search" /><input aria-label="搜索项目" placeholder="搜索项目…" value={search} onChange={e => setSearch(e.target.value)} /></label>
          </div>
          <div className="collab-project-list">
            {visibleProjects.map(item => {
              const list = sessions.filter(session => session.projectId === item.id && !archivedTasks.includes(session.id))
              const active = list.filter(session => runningSessions.includes(session.id)).length
              return (
                <button type="button" className="collab-project-row" key={item.id} onClick={() => onProject(item.id)}>
                  <span className="collab-project-glyph"><AppIcon name="folder" size={18} /></span>
                  <span className="collab-project-text"><strong>{item.name}</strong>{item.note && <small>{item.note}</small>}</span>
                  <span className="collab-project-meta">{active ? `${active} 项正在推进` : `${list.length} 次协作`}</span>
                  <span className="collab-task-state" data-state={item.status}>{projectStatus(item.status)}</span>
                  <AppIcon name="chevron-right" />
                </button>
              )
            })}
            {!visibleProjects.length && <div className="collab-page-empty"><AppIcon name={query ? 'search' : 'folder'} size={24} /><p>{query ? '没有匹配的项目。' : '暂无项目。'}</p></div>}
          </div>
          {allTasks.length > 0 && <section className="collab-legacy">
            <div className="collab-list-heading"><div><h2>未归属项目的协作记录</h2><p className="collab-description">打开后可将历史记录整理到项目。</p></div>{archiveToggle}</div>
            <div className="collab-task-list">{taskRows}{!tasks.length && <p className="collab-page-empty">暂无{showArchived ? '已归档' : '推进中'}的记录。</p>}</div>
          </section>}
        </> : project && <>
          <div className="collab-project-summary">
            {project.note && <p>{project.note}</p>}
            <div className="collab-project-facts">
              <span><AppIcon name="chat" />{allTasks.length} 次协作</span>
              <span><AppIcon name="table" />{members.length} 位项目成员</span>
              {activeCount > 0 && <span className="collab-live-label"><AppIcon name="play" />{activeCount} 项正在推进</span>}
            </div>
          </div>
          <ProjectWorkspaceStatus binding={workspace} busy={workspaceBusy} onConfigure={() => setEditor('workspace')} />
          <div className="collab-project-tabs" role="tablist" aria-label="项目内容分页">{projectTabs.map((tab, index) => <button type="button" role="tab" key={tab.id} id={`collab-project-tab-${tab.id}`} aria-selected={activeTab === tab.id} aria-controls={`collab-project-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => selectTab(tab.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % projectTabs.length : event.key === 'ArrowLeft' ? (index + projectTabs.length - 1) % projectTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? projectTabs.length - 1 : null
            if (next === null) return
            event.preventDefault()
            selectTab(projectTabs[next].id)
            document.getElementById(`collab-project-tab-${projectTabs[next].id}`)?.focus()
          }}><AppIcon name={tab.icon} />{tab.label}</button>)}</div>
          <section id="collab-project-sessions" role="tabpanel" aria-labelledby="collab-project-tab-sessions" tabIndex={0} hidden={activeTab !== 'sessions'} className="collab-project-tasks">
            <div className="collab-list-heading"><h2>{showArchived ? '已归档会话' : '协作会话'} <span className="collab-count">{tasks.length}</span></h2>{archiveToggle}</div>
            <div className="collab-task-list">
              {taskRows}
              {!tasks.length && <div className="collab-page-empty"><AppIcon name={showArchived ? 'archive' : 'chat'} size={24} /><p>{showArchived ? '暂无已归档会话。' : '暂无协作会话。'}</p></div>}
            </div>
          </section>
          <div id="collab-project-knowledge" role="tabpanel" aria-labelledby="collab-project-tab-knowledge" tabIndex={0} hidden={activeTab !== 'knowledge'}><ProjectKnowledge key={projectId} projectId={projectId} peers={peers} sessions={allTasks} onSession={id => { const session = sessions.find(s => s.id === id); if (session) onTask(session) }} /></div>
          <section id="collab-project-settings" role="tabpanel" aria-labelledby="collab-project-tab-settings" tabIndex={0} hidden={activeTab !== 'settings'} className="collab-project-settings">
            <div className="collab-project-setup-grid">
              <section className="collab-project-direction">
                <div className="collab-list-heading"><h3>工作方向</h3><button type="button" className="ui-btn ui-btn--quiet" onClick={() => setEditor('direction')}><AppIcon name="edit" />编辑</button></div>
                <p>{project.note || '尚未补充工作方向。'}</p>
              </section>
              <section className="collab-project-members">
                <div className="collab-list-heading"><h3>项目成员 <span className="collab-count">{members.length}</span></h3><button type="button" className="ui-btn ui-btn--quiet" onClick={() => setEditor('members')}><AppIcon name="table" />调整成员</button></div>
                <div className="collab-member-strip">
                  {members.map(member => <a key={member.id} href={`#/multi-agent/${encodeURIComponent(member.id)}`}><PeerAvatar name={member.name} avatar={member.avatar} size="h-9 w-9" /><span>{member.name}<small>{member.role || '成员'}</small></span></a>)}
                  {!members.length && <p>先到智能体页添加成员。</p>}
                </div>
              </section>
            </div>
          </section>
        </>}
      </div>
      {project && (editor === 'workspace' || (configureWorkspace && !loading && !workspaceBusy)) && <ProjectWorkspaceDialog projectId={projectId} projectName={project.name} binding={workspace} onSaved={onReload} onClose={closeWorkspace} />}
      {editor === 'create' && <CollaborationDialog title="新建项目" label="项目名称" initialNote="" submitLabel="创建项目" onClose={() => setEditor(null)} onSubmit={async (name, note) => { const p = await createProject({ name, note, kind: 'other' }); await onReload(); onProject(p.id) }} />}
      {editor === 'direction' && project && <CollaborationDialog title="编辑项目方向" label="项目名称" initialName={project.name} initialNote={project.note || ''} onClose={() => setEditor(null)} onSubmit={async (name, note) => { await updateProject(project.id, { name, note }); await onReload() }} />}
      {editor === 'members' && project && <CollaborationDialog title="调整项目成员" label="项目名称" nameReadOnly initialName={project.name} peers={peers} initialMembers={ids} onClose={() => setEditor(null)} onSubmit={async (_name, _note, picked) => { await saveCollaborationMembers(project.id, picked); await onReload() }} />}
    </div>
  )
}
