import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalTarget } from '../api/client'
import {
  connectWorkspaceTerminal,
  createWorkspaceTerminal,
  deleteWorkspaceTerminal,
  listWorkspaceTerminals,
  terminalError,
  type TerminalView,
} from '../api/terminal'
import { AppIcon } from '../components/AppIcon'
import FloatWindow from '../components/FloatWindow'
import { Select } from '../components/Select'
import TerminalSession from '../components/TerminalSession'
import './workspace/workspaceTools.css'

function Shell({ workspace }: { workspace: TerminalTarget }) {
  const [sessions, setSessions] = useState<{ items: TerminalView[]; activeId: string }>({
    items: [],
    activeId: '',
  })
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const alive = useRef(false)

  useEffect(() => {
    let stopped = false
    alive.current = true

    async function load() {
      try {
        const items = await listWorkspaceTerminals(workspace.id)
        if (stopped) return

        const running = items.filter(item => item.running)
        // Reopening the window resumes an existing session when one is available.
        if (!running.length && workspace.enabled) {
          running.push(await createWorkspaceTerminal(workspace.id))
        }
        if (stopped) return

        setSessions(previous => ({
          items: running,
          activeId: running.some(item => item.id === previous.activeId)
            ? previous.activeId
            : running[0]?.id ?? '',
        }))
        await Promise.all(items.filter(item => !item.running).map(item => deleteWorkspaceTerminal(workspace.id, item.id)))
      } catch (e) {
        if (!stopped) setError(terminalError(e))
      } finally {
        if (!stopped) setBusy(false)
      }
    }

    void load()
    return () => {
      stopped = true
      alive.current = false
    }
  }, [workspace.id, workspace.enabled, revision])

  const exited = useCallback((id: string, message?: string) => {
    setSessions(previous => ({
      items: previous.items.filter(item => item.id !== id),
      activeId: previous.activeId === id ? '' : previous.activeId,
    }))
    setError(message || 'Shell 已退出，可新建会话继续。')
  }, [])

  const create = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const terminal = await createWorkspaceTerminal(workspace.id)
      if (alive.current) {
        setSessions(previous => ({ items: [...previous.items, terminal], activeId: terminal.id }))
      }
    } catch (e) {
      if (alive.current) setError(terminalError(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const remove = async () => {
    if (busy || !sessions.activeId) return
    const id = sessions.activeId
    setBusy(true)
    setError('')
    try {
      await deleteWorkspaceTerminal(workspace.id, id)
      if (alive.current) {
        setSessions(previous => {
          const remaining = previous.items.filter(item => item.id !== id)
          return { items: remaining, activeId: remaining[0]?.id ?? '' }
        })
      }
    } catch (e) {
      if (alive.current) setError(terminalError(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const terminal = sessions.items.find(item => item.id === sessions.activeId)
  const idleMessage = workspace.enabled ? '新建 Shell，在工作空间中运行命令。' : '启用工作空间后即可打开 Shell。'

  return (
    <>
      <div className="workspace-tools__session-tools">
        <div className="workspace-tools__field">
          <span>会话</span>
          <Select
            label="Shell 会话"
            size="compact"
            value={sessions.activeId}
            disabled={busy}
            onChange={activeId => setSessions(previous => ({ ...previous, activeId }))}
            options={[
              { value: '', label: '选择会话' },
              ...sessions.items.map(item => ({ value: item.id, label: item.title })),
            ]}
          />
        </div>
        <div className="workspace-tools__actions">
          <button
            type="button"
            className="workspace-tools__button"
            disabled={busy || !workspace.enabled}
            onClick={() => void create()}
          >
            <AppIcon name="plus" size={15} />
            新建 Shell
          </button>
          <button
            type="button"
            className="workspace-tools__button workspace-tools__button--end"
            disabled={busy || !terminal}
            onClick={() => void remove()}
          >
            <AppIcon name="stop" size={14} />
            结束会话
          </button>
        </div>
      </div>
      {error && (
        <div className="workspace-tools__notice" role="alert">
          <AppIcon name="alert" size={16} />
          <span>{error}</span>
          <button
            type="button"
            className="workspace-tools__button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              setRevision(value => value + 1)
            }}
          >
            重新加载
          </button>
        </div>
      )}
      <div className="workspace-tools__terminal">
        {terminal ? (
          <TerminalSession
            scope={workspace.id}
            terminal={terminal}
            active
            onExit={exited}
            connect={connectWorkspaceTerminal}
          />
        ) : (
          <div className="workspace-tools__state" role="status">
            <AppIcon name={busy ? 'loading' : 'terminal'} size={22} />
            <p>{busy ? '正在打开 Shell…' : idleMessage}</p>
          </div>
        )}
      </div>
    </>
  )
}

export default function WorkspaceShell({
  targets,
  initialTarget,
  onClose,
}: {
  targets: TerminalTarget[]
  initialTarget: string
  onClose: () => void
}) {
  const [targetId, setTargetId] = useState(initialTarget)
  const workspace = targets.find(item => item.id === targetId)

  return (
    <FloatWindow
      title={
        <span className="workspace-tools__title">
          <AppIcon name="terminal" />
          <span>{workspace ? `Shell · ${workspace.name}` : 'Shell'}</span>
        </span>
      }
      width={920}
      onClose={onClose}
    >
      <div className="workspace-tools workspace-tools--shell">
        <div className="workspace-tools__field">
          <span>工作空间</span>
          <Select
            label="Shell 工作空间"
            size="compact"
            value={workspace?.id ?? ''}
            onChange={setTargetId}
            options={[
              { value: '', label: '选择工作空间' },
              ...targets.map(item => ({
                value: item.id,
                label: item.enabled ? item.name : `${item.name}（未启用）`,
                disabled: !item.enabled,
              })),
            ]}
          />
        </div>
        {workspace ? (
          <Shell key={`${workspace.id}:${workspace.enabled}`} workspace={workspace} />
        ) : (
          <div className="workspace-tools__state workspace-tools__state--boxed">
            <AppIcon name="terminal" size={22} />
            <p>选择已启用的工作空间即可打开 Shell。</p>
          </div>
        )}
        <p className="workspace-tools__note">关闭窗口会保留会话，离线 30 分钟后自动回收。交互命令不计入「最近执行」。</p>
      </div>
    </FloatWindow>
  )
}
