import { useEffect, useState } from 'react'
import {
  ApiError,
  createTerminalTarget,
  deleteTerminalTarget,
  getTerminal,
  listTerminalCommands,
  loginUrlOf,
  probeTerminalTarget,
  runTerminalCommand,
  updateTerminalTarget,
  type TerminalCommand,
  type TerminalTarget,
  type TerminalTargetRequest,
  type TerminalView,
} from '../api/client'
import { AppIcon, type AppIconName } from '../components/AppIcon'
import FloatWindow from '../components/FloatWindow'
import { Field, INPUT } from '../components/formKit'
import { PortalAppearanceContext } from '../components/portalAppearance'
import Toast from '../components/Toast'
import ComputerConnection from './ComputerConnection'
import WorkspaceDialog from './WorkspaceDialog'
import WorkspaceShell from './WorkspaceShell'
import WorkspaceFiles from './workspace/WorkspaceFiles'
import WorkspaceHistory from './workspace/WorkspaceHistory'
import './workspace/workspacePage.css'

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body?.trim()
    if (body) {
      try {
        const parsed = JSON.parse(body) as { message?: string } | null
        if (parsed?.message) return parsed.message
      } catch {
        // 部分接口返回纯文本错误。
      }
      return body
    }
    return `请求失败（${error.status}）`
  }
  return error instanceof Error ? error.message : String(error)
}

const environmentTypes = {
  docker: { label: 'Docker', icon: 'workspace' },
  ssh: { label: 'SSH', icon: 'terminal' },
  local: { label: '本机', icon: 'system' },
} satisfies Record<TerminalTarget['kind'], { label: string; icon: AppIconName }>

function environmentAddress(target: TerminalTarget): string {
  if (target.kind === 'local') return target.workdir ?? ''
  if (target.kind === 'docker') {
    const source = target.container ? `容器 ${target.container}` : `镜像 ${target.image || '未指定'}`
    return target.dockerHost ? `${source} @ ${target.dockerHost}` : source
  }
  return `${target.sshUser || 'root'}@${target.sshHost ?? ''}:${target.sshPort ?? 22}`
}

function EnvironmentList({
  targets,
  selectedId,
  onSelect,
}: {
  targets: TerminalTarget[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const matches = targets.filter(target =>
    `${target.name} ${environmentTypes[target.kind].label} ${environmentAddress(target)}`.toLowerCase().includes(search),
  )

  return (
    <section className="workspace-environments" aria-labelledby="workspace-environments-title">
      <div className="workspace-environments__heading">
        <h2 id="workspace-environments-title">运行环境</h2>
        <span aria-label={`${targets.length} 个环境`}>{targets.length}</span>
      </div>
      {targets.length > 1 && (
        <label className="workspace-environments__search">
          <AppIcon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder="搜索环境"
            aria-label="搜索环境"
            onChange={event => setQuery(event.target.value)}
          />
        </label>
      )}
      <ul className="workspace-environments__list scrollbar-slim">
        {matches.map(target => (
          <li key={target.id}>
            <button
              type="button"
              className="workspace-environment"
              aria-current={target.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(target.id)}
            >
              <span className="workspace-environment__icon">
                <AppIcon name={environmentTypes[target.kind].icon} size={17} />
              </span>
              <span className="workspace-environment__body">
                <strong title={target.name}>{target.name}</strong>
                <span title={environmentAddress(target)}>{environmentTypes[target.kind].label} · {environmentAddress(target)}</span>
              </span>
              <span className="workspace-status-dot" data-enabled={target.enabled} title={target.enabled ? '已启用' : '未启用'} />
              <span className="sr-only">{target.enabled ? '已启用' : '未启用'}</span>
            </button>
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p className="workspace-environments__empty" role="status">没有匹配的环境</p>}
    </section>
  )
}

function LocalCommand({ target, onClose }: { target: TerminalTarget; onClose: () => void }) {
  const [command, setCommand] = useState('')
  const [result, setResult] = useState<TerminalCommand | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  async function run() {
    if (running || !command.trim()) return
    setRunning(true)
    setResult(null)
    setError('')
    try {
      setResult(await runTerminalCommand(target.id, command))
    } catch (error) {
      const loginUrl = loginUrlOf(error)
      if (loginUrl) window.location.assign(loginUrl)
      else setError(errorText(error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <FloatWindow title={`试跑命令 · ${target.name}`} width={620} onClose={onClose}>
      <form className="workspace-command" onSubmit={event => {
        event.preventDefault()
        void run()
      }}>
        <Field label="本机命令" hint="命令使用与 Agent 相同的写入白名单。">
          <textarea
            className={INPUT}
            value={command}
            onChange={event => setCommand(event.target.value)}
            rows={3}
            placeholder="pwd"
            spellCheck={false}
          />
        </Field>
        <button type="submit" className="workspace-button workspace-button--primary" disabled={running || !command.trim()}>
          <AppIcon name="play" />{running ? '执行中…' : '执行'}
        </button>
        {error && <p role="alert">{error}</p>}
        {result && (
          <div role="status">
            <p>{result.ok ? '执行成功' : result.timedOut ? '执行超时' : '执行失败'}{result.exitCode != null ? ` · 退出码 ${result.exitCode}` : ''}{result.truncated ? ' · 输出已截断' : ''}</p>
            {result.stdout && <pre tabIndex={0} aria-label="标准输出">{result.stdout}</pre>}
            {result.stderr && <pre tabIndex={0} aria-label="错误输出">{result.stderr}</pre>}
          </div>
        )}
      </form>
    </FloatWindow>
  )
}

export default function Workspace() {
  const [view, setView] = useState<TerminalView | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)
  const [dialog, setDialog] = useState<{ editing: TerminalTarget | null } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState(() =>
    new URLSearchParams(window.location.hash.split('?')[1] || '').get('target') ?? '',
  )
  const [filesRevision, setFilesRevision] = useState(0)
  const [shellTarget, setShellTarget] = useState<string | null>(null)
  const [commandTargetId, setCommandTargetId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [commands, setCommands] = useState<TerminalCommand[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getTerminal()
      .then(next => { if (active) setView(next) })
      .catch((error: unknown) => { if (active) setLoadErr(errorText(error)) })
    return () => { active = false }
  }, [loadAttempt])

  const targets = view?.targets ?? []
  const selected = targets.find(target => target.id === selectedId)
  const deleteTarget = targets.find(target => target.id === deleteId)
  const localAvailable = view?.localAvailable === true
  const localManageable = localAvailable && view?.localManageable !== false
  const localUnavailableReason = view?.localUnavailableReason ?? (
    view?.localAvailable === undefined
      ? '当前后端版本未提供本机环境，请更新后端。'
      : '当前后端无法启动本机环境。'
  )
  const localManageReason = localAvailable ? '请以管理员身份管理本机工作空间。' : localUnavailableReason
  const commandTarget = localManageable
    ? targets.find(target => target.id === commandTargetId && target.kind === 'local' && target.enabled)
    : undefined
  const shellTargets = targets.filter(target => target.kind !== 'local')

  function fail(error: unknown) {
    const loginUrl = loginUrlOf(error)
    if (loginUrl) {
      window.location.assign(loginUrl)
      return
    }
    setToast({ kind: 'error', msg: errorText(error) })
  }

  async function refreshCommands() {
    if (historyLoading) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      setCommands(await listTerminalCommands(20))
    } catch (error) {
      setHistoryError(errorText(error))
    } finally {
      setHistoryLoading(false)
    }
  }

  async function updateView(action: () => Promise<TerminalView>, message: string): Promise<TerminalView | null> {
    setBusy(true)
    try {
      const next = await action()
      setView(next)
      setToast({ kind: 'success', msg: message })
      return next
    } catch (error) {
      fail(error)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function submitTarget(request: TerminalTargetRequest) {
    const editing = dialog?.editing
    const saved = await updateView(
      () => editing ? updateTerminalTarget(editing.id, request) : createTerminalTarget(request),
      editing ? '工作空间已更新' : '工作空间已创建',
    )
    if (saved) {
      setDialog(null)
      if (editing?.id === selectedId) setFilesRevision(value => value + 1)
      if (!editing && request.kind === 'local') {
        const created = saved.targets.find(target => target.name === request.name && target.kind === 'local')
        if (created) setSelectedId(created.id)
      }
    }
  }

  async function probeTarget(target: TerminalTarget) {
    setProbing(target.id)
    try {
      const result = await probeTerminalTarget(target.id)
      setToast(result.ok
        ? {
            kind: 'success',
            msg: `「${target.name}」${target.kind === 'local' ? '环境可用' : '连接正常'}（${(result.elapsedMs / 1000).toFixed(1)} 秒）${result.detail ? ` · ${result.detail}` : ''}`,
          }
        : { kind: 'error', msg: `「${target.name}」${target.kind === 'local' ? '环境不可用' : '连接失败'}：${result.error ?? '未知错误'}` })
    } catch (error) {
      fail(error)
    } finally {
      setProbing(null)
    }
  }

  return (
    <PortalAppearanceContext value="rukksh-surface workspace-popover">
      <div className="workspace-page">
        <div className="workspace-toolbar">
          <p>管理智能体可访问的运行环境。</p>
          <div className="workspace-toolbar__actions">
            <ComputerConnection />
            {selected?.kind !== 'local' && (shellTargets.length > 0 || targets.length === 0) && (
              <button
                type="button"
                className="workspace-button"
                onClick={() => setShellTarget(selected?.id ?? shellTargets.find(target => target.enabled)?.id ?? '')}
              >
                <AppIcon name="terminal" />Shell
              </button>
            )}
            <button
              type="button"
              className="workspace-button"
              onClick={() => {
                setHistoryOpen(true)
                void refreshCommands()
              }}
            >
              <AppIcon name="clock" />最近执行
            </button>
            <button
              type="button"
              className="workspace-button workspace-button--primary"
              disabled={busy || !view}
              onClick={() => setDialog({ editing: null })}
            >
              <AppIcon name="plus" />新建工作空间
            </button>
          </div>
        </div>

        {loadErr ? (
          <div className="workspace-state workspace-state--error">
            <span className="workspace-state__icon"><AppIcon name="alert" size={23} /></span>
            <h2>无法读取工作空间</h2>
            <p role="alert">{loadErr}</p>
            <button type="button" className="workspace-button" onClick={() => {
              setLoadErr(null)
              setLoadAttempt(value => value + 1)
            }}>
              <AppIcon name="refresh" />重新加载
            </button>
          </div>
        ) : !view ? (
          <div className="workspace-state" role="status">
            <span className="workspace-state__icon"><AppIcon name="loading" size={23} className="workspace-spinner" /></span>
            <p>正在加载工作空间…</p>
          </div>
        ) : targets.length === 0 ? (
          <div className="workspace-state">
            <span className="workspace-state__icon"><AppIcon name="workspace" size={24} /></span>
            <h2>还没有工作空间</h2>
            <p>添加{view.localAvailable ? '本机环境、Docker 容器或 SSH 服务器' : 'Docker 容器或 SSH 服务器'}，为 Agent 提供运行环境。</p>
          </div>
        ) : (
          <div className="workspace-layout">
            <EnvironmentList targets={targets} selectedId={selectedId} onSelect={setSelectedId} />
            {selected ? (
              <section className="workspace-detail" aria-labelledby="workspace-detail-title">
                <div className="workspace-detail__header">
                  <span className="workspace-detail__icon">
                    <AppIcon name={environmentTypes[selected.kind].icon} size={22} />
                  </span>
                  <div className="workspace-detail__info">
                    <div className="workspace-detail__name">
                      <h2 id="workspace-detail-title">{selected.name}</h2>
                      <span className="workspace-label">{environmentTypes[selected.kind].label}</span>
                      <span className="workspace-label workspace-label--status" data-enabled={selected.enabled}>
                        <span className="workspace-status-dot" data-enabled={selected.enabled} />
                        {selected.enabled ? '已启用' : '未启用'}
                      </span>
                    </div>
                    <p className="workspace-detail__address">{environmentAddress(selected)}</p>
                    {selected.kind === 'local' && (
                      selected.writePaths?.length ? (
                        <details className="workspace-detail__allowlist">
                          <summary>写入白名单（{selected.writePaths.length} 个目录）</summary>
                          <ul>{selected.writePaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
                        </details>
                      ) : <p className="workspace-detail__note">只读访问</p>
                    )}
                    {selected.note && <p className="workspace-detail__note">{selected.note}</p>}
                  </div>
                  <div className="workspace-detail__actions">
                    <button
                      type="button"
                      className="workspace-button"
                      disabled={busy || probing !== null || (selected.kind === 'local' && !localManageable)}
                      onClick={() => void probeTarget(selected)}
                    >
                      <AppIcon name={probing === selected.id ? 'loading' : 'link'} className={probing === selected.id ? 'workspace-spinner' : undefined} />
                      {selected.kind === 'local'
                        ? probing === selected.id ? '检测中…' : '检测环境'
                        : probing === selected.id ? '连接中…' : '测试连接'}
                    </button>
                    {selected.kind === 'local' && (
                      <button type="button" className="workspace-button" disabled={busy || !selected.enabled || !localManageable}
                        onClick={() => setCommandTargetId(selected.id)}>
                        <AppIcon name="play" />试跑命令
                      </button>
                    )}
                    <button type="button" className="workspace-button" disabled={busy || (selected.kind === 'local' && !localManageable)} onClick={() => setDialog({ editing: selected })}>
                      <AppIcon name="edit" />编辑
                    </button>
                    <button
                      type="button"
                      className="workspace-button workspace-button--icon workspace-button--danger"
                      aria-label={`删除工作空间 ${selected.name}`}
                      title="删除工作空间"
                      disabled={busy || (selected.kind === 'local' && view.localManageable === false)}
                      onClick={() => setDeleteId(selected.id)}
                    >
                      <AppIcon name="trash" />
                    </button>
                  </div>
                </div>
                {selected.kind === 'local' && (!selected.enabled || !view.localAvailable) ? (
                  <div className="workspace-state">
                    <span className="workspace-state__icon"><AppIcon name="folder-open" size={24} /></span>
                    <p>{localAvailable ? '启用本机工作空间后即可浏览文件。' : localUnavailableReason}</p>
                  </div>
                ) : <WorkspaceFiles key={`${selected.id}:${filesRevision}`} workspace={selected} onToast={setToast} />}
              </section>
            ) : (
              <div className="workspace-state">
                <span className="workspace-state__icon"><AppIcon name="folder-open" size={24} /></span>
                <h2>选择工作空间</h2>
                <p>选择一个运行环境，即可查看文件和管理连接。</p>
              </div>
            )}
          </div>
        )}

        {shellTarget !== null && (
          <WorkspaceShell key={shellTarget} targets={shellTargets} initialTarget={shellTarget} onClose={() => setShellTarget(null)} />
        )}
        {commandTarget && <LocalCommand key={commandTarget.id} target={commandTarget} onClose={() => setCommandTargetId(null)} />}
        {historyOpen && (
          <WorkspaceHistory
            commands={commands}
            loading={historyLoading}
            error={historyError}
            onRefresh={() => void refreshCommands()}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        {dialog && (
          <WorkspaceDialog
            key={dialog.editing?.id ?? 'new'}
            initial={dialog.editing}
            localAvailable={localManageable}
            localUnavailableReason={localManageReason}
            busy={busy}
            onClose={() => setDialog(null)}
            onSubmit={request => void submitTarget(request)}
          />
        )}
        {deleteTarget && (
          <FloatWindow title="删除工作空间" width={420} onClose={() => setDeleteId(null)}>
            <div className="workspace-confirm">
              <p>确定删除工作空间「<strong>{deleteTarget.name}</strong>」？</p>
              <div className="workspace-confirm__actions">
                <button type="button" className="workspace-button" onClick={() => setDeleteId(null)}>取消</button>
                <button
                  type="button"
                  className="workspace-button workspace-button--destructive"
                  disabled={busy}
                  onClick={() => {
                    setDeleteId(null)
                    void updateView(() => deleteTerminalTarget(deleteTarget.id), '工作空间已删除')
                  }}
                >
                  删除工作空间
                </button>
              </div>
            </div>
          </FloatWindow>
        )}
        <Toast kind={toast?.kind} message={toast?.msg ?? null} onClose={() => setToast(null)} />
      </div>
    </PortalAppearanceContext>
  )
}
