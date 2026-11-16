import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { listWorkspaceFiles, type WorkspaceDirView } from '../../api/client'
import { codingError, openCodingProject, type CodingProject, type CodingRun, type CodingWorkspace } from '../../api/coding'
import { AppIcon } from '../../components/AppIcon'
import { Select } from '../../components/Select'
import './projectPicker.css'

type Props = {
  projects: CodingProject[]
  workspaces: CodingWorkspace[]
  runs: CodingRun[]
  onOpen: (project: CodingProject) => void
  onRemoveRecent: (project: CodingProject) => Promise<void>
  onReload: () => Promise<void>
  initialWorkspace: string
  initialDirectory: string
  error: string
  enabled: boolean
  activeProjectId?: string
  loading?: boolean
  menuHost: HTMLDivElement | null
}

const hiddenDirectories = new Set(['.git', '.rukksh-coding', '.minis-coding', 'node_modules', 'target', 'dist', '.ssh', '.aws'])
const parentOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'

export default function CodingProjectPicker({
  projects, workspaces, runs, onOpen, onRemoveRecent, onReload, initialWorkspace,
  initialDirectory, error: pageError, enabled, activeProjectId, loading = false, menuHost,
}: Props) {
  const pickerId = useId()
  const mounted = useRef(true)
  const openButton = useRef<HTMLButtonElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const [choice, setChoice] = useState<'create' | 'open' | null>(initialWorkspace || initialDirectory !== '.' ? 'open' : null)
  const [workspaceSelection, setWorkspaceSelection] = useState<string | null>(initialWorkspace || null)
  const [directory, setDirectory] = useState(initialDirectory)
  const [result, setResult] = useState<{ key: string; view?: WorkspaceDirView; error?: string } | null>(null)
  const [name, setName] = useState('')
  const [validation, setValidation] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [removing, setRemoving] = useState('')
  const [removeError, setRemoveError] = useState('')
  const firstWorkspace = workspaces.find(workspace => workspace.enabled)
  const workspaceId = workspaceSelection ?? firstWorkspace?.id ?? ''
  const workspace = workspaces.find(item => item.id === workspaceId)
  const canBrowse = choice !== null && enabled && !loading && !reloading && !!workspace?.enabled
  const requestKey = JSON.stringify([workspaceId, directory, refresh])
  const currentResult = canBrowse && result?.key === requestKey ? result : null
  const directoryLoading = canBrowse && !currentResult
  const directories = currentResult?.view?.entries.filter(entry => entry.dir && !entry.link && !hiddenDirectories.has(entry.name)) ?? []
  const creating = choice === 'create'
  const canSubmit = !!currentResult?.view && !busy && !removing && (!creating || !!name.trim())

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!canBrowse) return
    let current = true
    void listWorkspaceFiles(workspaceId, directory).then(view => {
      if (current) setResult({ key: requestKey, view })
    }).catch(error => {
      if (current) setResult({ key: requestKey, error: codingError(error) })
    })
    return () => { current = false }
  }, [canBrowse, directory, requestKey, workspaceId])

  const choose = (next: 'create' | 'open' | null) => {
    if (!next) setResult(null)
    setChoice(next)
    setActionError('')
  }

  const closePicker = () => {
    const trigger = creating ? createButton.current : openButton.current
    trigger?.focus()
    choose(null)
  }

  const goTo = (path: string) => {
    if (path === directory) return
    setResult(null)
    setDirectory(path)
    setActionError('')
  }

  const selectWorkspace = (id: string) => {
    if (id === workspaceId) return
    setWorkspaceSelection(id)
    setDirectory('.')
    setResult(null)
    setName('')
    setActionError('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setActionError('')
    try {
      const project = await openCodingProject({
        workspaceId,
        directory,
        name: creating ? name.trim() : undefined,
        create: creating,
        validationCommand: validation.trim() || undefined,
      })
      if (mounted.current) onOpen(project)
    } catch (error) {
      if (mounted.current) setActionError(codingError(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const reload = async () => {
    if (reloading) return
    setReloading(true)
    setActionError('')
    try {
      await onReload()
      if (mounted.current) setRefresh(value => value + 1)
    } catch (error) {
      if (mounted.current) setActionError(codingError(error))
    } finally {
      if (mounted.current) setReloading(false)
    }
  }

  const removeRecent = async (project: CodingProject) => {
    if (removing) return
    setRemoving(project.id)
    setRemoveError('')
    try {
      await onRemoveRecent(project)
    } catch (error) {
      if (mounted.current) setRemoveError(`移除失败：${codingError(error)}`)
    } finally {
      if (mounted.current) setRemoving('')
    }
  }

  if (loading) {
    return <div className="coding-project-picker"><p className="coding-picker-note" role="status">正在加载编程项目…</p></div>
  }

  return (
    <div className="coding-project-picker">
      {(pageError || !enabled) && (
        <div className="coding-picker-notice">
          <p role="alert">{pageError || '编程模块未启用'}</p>
          <button type="button" className="coding-picker-button" disabled={reloading || busy || !!removing} onClick={() => void reload()}>
            {reloading ? '正在重新加载…' : '重新加载'}
          </button>
        </div>
      )}
      <div className="coding-picker-actions">
        <button ref={openButton} type="button" className="coding-picker-button is-primary" disabled={!enabled || busy || reloading}
          aria-expanded={choice === 'open'} aria-controls={choice ? pickerId : undefined}
          onClick={() => choose(choice === 'open' ? null : 'open')}>
          <AppIcon name="folder-open" size={16} />打开目录
        </button>
        <button ref={createButton} type="button" className="coding-picker-button" disabled={!enabled || busy || reloading}
          aria-expanded={creating} aria-controls={choice ? pickerId : undefined}
          onClick={() => choose(creating ? null : 'create')}>
          <AppIcon name="plus" size={16} />新建项目
        </button>
      </div>

      {choice && (
        <section className="coding-picker-browser" id={pickerId} aria-labelledby={`${pickerId}-title`}>
          <div className="coding-picker-heading">
            <h3 id={`${pickerId}-title`}>{creating ? '选择父目录' : '选择项目目录'}</h3>
            <button type="button" className="coding-picker-button is-quiet is-icon" disabled={busy || reloading}
              aria-label="收起目录选择" title="收起目录选择" onClick={closePicker}>
              <AppIcon name="close" size={16} />
            </button>
          </div>
          {!firstWorkspace ? (
            <div className="coding-picker-notice">
              <p>先添加并启用一个工作空间。</p>
              <a className="coding-picker-button" href="#/workspace">管理工作空间</a>
            </div>
          ) : (
            <form className="coding-picker-form" onSubmit={event => void submit(event)}>
              <div className="coding-picker-field">
                <span>工作空间</span>
                <Select menuHost={menuHost} size="compact" label="工作空间"
                  value={workspaceId} disabled={busy || reloading || !enabled} onChange={selectWorkspace}
                  options={[
                    { value: '', label: '选择工作空间' },
                    ...workspaces.map(item => ({
                      value: item.id,
                      label: `${item.name} · ${item.kind.toUpperCase()}${item.enabled ? '' : '（未启用）'}`,
                      disabled: !item.enabled,
                    })),
                  ]}
                />
              </div>
              {workspace?.enabled && (
                <div className="coding-picker-directory">
                  <div className="coding-picker-heading">
                    <nav className="coding-picker-breadcrumb" aria-label="当前目录">
                      <button type="button" disabled={busy} onClick={() => goTo('.')}>{workspace.name}</button>
                      {directory !== '.' && directory.split('/').map((part, i, parts) => (
                        <span key={i}>
                          <span aria-hidden="true">/</span>
                          <button type="button" disabled={busy} onClick={() => goTo(parts.slice(0, i + 1).join('/'))}>{part}</button>
                        </span>
                      ))}
                    </nav>
                    <button type="button" className="coding-picker-button is-quiet is-icon" disabled={directoryLoading || busy || !enabled}
                      aria-label="刷新目录" title="刷新目录" onClick={() => setRefresh(value => value + 1)}>
                      <AppIcon name="refresh" size={16} />
                    </button>
                  </div>
                  <div className="coding-picker-directory-list scrollbar-slim" aria-busy={directoryLoading}>
                    {directory !== '.' && (
                      <button type="button" disabled={busy} onClick={() => goTo(parentOf(directory))}>
                        <AppIcon name="arrow-up" size={16} />上一级目录
                      </button>
                    )}
                    {directoryLoading && <p className="coding-picker-note" role="status">正在读取目录…</p>}
                    {currentResult?.error && <p className="coding-picker-error" role="alert">{currentResult.error}</p>}
                    {directories.map(entry => (
                      <button type="button" key={entry.name} disabled={busy}
                        onClick={() => goTo(directory === '.' ? entry.name : `${directory}/${entry.name}`)}>
                        <AppIcon name="folder" size={16} />
                        <span>{entry.name}</span>
                        <AppIcon name="chevron-right" size={16} />
                      </button>
                    ))}
                    {currentResult?.view && !directories.length && <p className="coding-picker-note">没有子目录</p>}
                  </div>
                </div>
              )}
              {workspaceId && !workspace?.enabled && <p className="coding-picker-error" role="alert">所选工作空间不可用</p>}
              {creating && (
                <label className="coding-picker-field">
                  <span>项目名称</span>
                  <input value={name} onChange={event => setName(event.target.value)} placeholder="例如 my-next-app" maxLength={100} disabled={busy} />
                </label>
              )}
              <details className="coding-picker-options">
                <summary>验证设置（可选）</summary>
                <label className="coding-picker-field">
                  <span>验证命令</span>
                  <input value={validation} onChange={event => setValidation(event.target.value)}
                    placeholder="例如 npm run build" disabled={busy} />
                </label>
              </details>
              {workspace?.enabled && (
                <div className="coding-picker-footer">
                  <code>{workspace.workdir || '工作空间默认目录'}{directory === '.' ? '' : `/${directory}`}</code>
                  <button className="coding-picker-button is-primary" type="submit" disabled={!canSubmit || reloading}>
                    {busy ? '正在打开…' : creating ? '创建并打开' : '打开此目录'}
                  </button>
                </div>
              )}
            </form>
          )}
        </section>
      )}
      {actionError && <p className="coding-picker-error" role="alert">{actionError}</p>}

      <section className="coding-picker-recent" aria-labelledby={`${pickerId}-recent`}>
        <h3 id={`${pickerId}-recent`}>最近项目</h3>
        {removeError && <p className="coding-picker-error" role="alert">{removeError}</p>}
        {!projects.length ? (
          <p className="coding-picker-note">暂无最近项目</p>
        ) : (
          <ul className="coding-picker-projects" role="list">
            {projects.map(project => {
              const latest = runs.find(run => run.repositoryId === project.id)
              const current = project.id === activeProjectId
              return (
                <li key={project.id}>
                  <button type="button" className="coding-picker-project" aria-current={current || undefined}
                    onClick={() => onOpen(project)} disabled={busy || reloading || removing === project.id}>
                    <span className="coding-picker-project-icon"><AppIcon name="folder" size={17} /></span>
                    <span className="coding-picker-project-name">
                      <strong>{project.name}</strong>
                      <small>{project.workspaceName} / {project.directory === '.' ? '根目录' : project.directory}</small>
                    </span>
                    <span className="coding-picker-project-meta">
                      {current ? '当前项目' : !project.enabled ? '工作空间不可用' : latest ? new Date(latest.updatedAt).toLocaleDateString('zh-CN') : project.kind.toUpperCase()}
                    </span>
                  </button>
                  <button type="button" className="coding-picker-button is-quiet is-icon coding-picker-remove"
                    aria-label={removing === project.id ? `正在移除 ${project.name}` : `从最近项目移除 ${project.name}`}
                    title="从最近项目移除" disabled={busy || reloading || !!removing} onClick={() => void removeRecent(project)}>
                    <AppIcon name={removing === project.id ? 'loading' : 'close'} size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
