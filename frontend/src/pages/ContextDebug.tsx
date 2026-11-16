import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { listSessions, sessionContextManifests, sessionRawContext, sessionScenes, type ContextManifest } from '../api/client'
import { AppIcon } from '../components/AppIcon'
import { DebugAssemblyView } from '../components/JsonViewer'
import { LoadState } from '../components/LoadState'
import { Select } from '../components/Select'
import { PortalAppearanceContext } from '../components/portalAppearance'
import { DebugManifests, DebugScenes } from './debug/DebugRecords'
import './debug/contextDebug.css'
import './debug/debugAssembly.css'

const TABS = [
  { id: 'assembly', label: '装配视图', icon: 'code' },
  { id: 'manifests', label: '出站 Manifest', icon: 'external' },
  { id: 'scenes', label: '任务段', icon: 'flow' },
] as const
type Tab = (typeof TABS)[number]['id']

type DebugRead<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

function useDebugRead<T, Key>(read: (key: Key) => Promise<T>, key: Key, revision = 0) {
  const [result, setResult] = useState<DebugRead<T>>({ data: null, loading: true, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setResult(current => ({ ...current, loading: true, error: null }))
    read(key)
      .then(data => { if (alive) setResult({ data, loading: false, error: null }) })
      .catch((error: unknown) => {
        if (!alive) return
        setResult(current => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : '加载失败',
        }))
      })
    return () => { alive = false }
  }, [read, key, revision, attempt])

  return { ...result, retry: () => setAttempt(value => value + 1) }
}

const fmtNum = (n: number) => Math.round(n).toLocaleString('en-US')

function ContextCapacity({ manifest }: { manifest: ContextManifest }) {
  const selection = manifest.selection
  const total = selection.contextWindow
  if (total <= 0) return null
  const used = Math.max(0, selection.estimatedInputTokens)
  const reserve = Math.max(0, selection.reservedOutputTokens)
  const safety = Math.max(0, selection.safetyTokens)
  const remaining = Math.max(0, total - used)
  const usable = Math.max(0, remaining - reserve - safety)
  const share = (tokens: number) => Math.min(100, tokens / total * 100)

  return (
    <details className="ctx-debug-capacity">
      <summary>
        <span className="ctx-debug-capacity__label">上下文容量</span>
        <span className="ctx-debug-capacity__usage">{fmtNum(used)} / {fmtNum(total)} Token</span>
        <span className="ctx-debug-capacity__bar" aria-hidden="true">
          <span className="ctx-debug-capacity__used" style={{ width: `${share(used)}%` }} />
          <span className="ctx-debug-capacity__reserve" style={{ width: `${share(reserve)}%` }} />
          <span className="ctx-debug-capacity__safety" style={{ width: `${share(safety)}%` }} />
        </span>
        <AppIcon name="chevron-down" size={14} />
      </summary>
      <div className="ctx-debug-capacity__details">
        <p className="ctx-debug-meta">最近一次出站 · Turn {manifest.turnId} · 输入占 {share(used).toFixed(1)}%</p>
        <dl className="ctx-debug-capacity__values">
          <div><dt>剩余</dt><dd>{fmtNum(remaining)}</dd></div>
          <div><dt>输出预留</dt><dd>{fmtNum(reserve)}</dd></div>
          <div><dt>安全余量</dt><dd>{fmtNum(safety)}</dd></div>
          <div><dt>扣除预留后可用</dt><dd>{fmtNum(usable)}</dd></div>
        </dl>
      </div>
    </details>
  )
}

function DiagnosticPanel<T>({ groupId, id, active, resource, summary, children }: {
  groupId: string
  id: Tab
  active: boolean
  resource: DebugRead<T> & { retry: () => void }
  summary?: ReactNode
  children: (data: T) => ReactNode
}) {
  const label = TABS.find(tab => tab.id === id)?.label
  return (
    <section
      id={`${groupId}-panel-${id}`}
      className="ctx-debug-panel"
      role="tabpanel"
      aria-labelledby={`${groupId}-tab-${id}`}
      hidden={!active}
      tabIndex={0}
    >
      <LoadState loading={resource.loading} error={resource.error} hasData={resource.data !== null} onRetry={resource.retry} label={label} />
      {summary}
      {resource.data !== null && children(resource.data)}
    </section>
  )
}

// The parent keys this component by session ID, so a different session starts with fresh diagnostics.
function DebugSession({ sessionId, tab, onTab, onRefreshSessions, refreshingSessions }: {
  sessionId: string
  tab: Tab
  onTab: (next: Tab) => void
  onRefreshSessions: () => void
  refreshingSessions: boolean
}) {
  const groupId = useId()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [revision, setRevision] = useState(0)
  const assembly = useDebugRead(sessionRawContext, sessionId, revision)
  const manifests = useDebugRead(sessionContextManifests, sessionId, revision)
  const scenes = useDebugRead(sessionScenes, sessionId, revision)
  const latest = manifests.error ? undefined : manifests.data?.[0]

  const selectTab = (next: Tab) => {
    if (next === tab) return
    const workspace = workspaceRef.current
    const toolbar = toolbarRef.current
    if (workspace && toolbar && toolbar.getBoundingClientRect().top > workspace.getBoundingClientRect().top) {
      workspace.scrollIntoView({ block: 'start' })
    }
    onTab(next)
  }

  return (
    <div className="ctx-debug-workspace" ref={workspaceRef}>
      <div className="ctx-debug-toolbar" ref={toolbarRef}>
        <div className="ctx-debug-tabs" role="tablist" aria-label="上下文诊断视图">
          {TABS.map(({ id, label, icon }, index) => (
            <button
              key={id}
              id={`${groupId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${groupId}-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => selectTab(id)}
              onKeyDown={event => {
                let next: number
                switch (event.key) {
                  case 'ArrowRight': next = (index + 1) % TABS.length; break
                  case 'ArrowLeft': next = (index + TABS.length - 1) % TABS.length; break
                  case 'Home': next = 0; break
                  case 'End': next = TABS.length - 1; break
                  default: return
                }
                event.preventDefault()
                const nextId = TABS[next].id
                selectTab(nextId)
                document.getElementById(`${groupId}-tab-${nextId}`)?.focus({ preventScroll: true })
              }}
            >
              <AppIcon name={icon} size={15} />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ctx-debug-button"
          onClick={() => {
            if (refreshingSessions) return
            onRefreshSessions()
            setRevision(value => value + 1)
          }}
          aria-disabled={refreshingSessions}
          aria-label="刷新会话列表和当前诊断"
          title="刷新会话列表和当前诊断"
        >
          <AppIcon name="refresh" />
          <span>刷新</span>
        </button>
      </div>

      <DiagnosticPanel
        groupId={groupId}
        id="assembly"
        active={tab === 'assembly'}
        resource={assembly}
        summary={latest && <ContextCapacity manifest={latest} />}
      >
        {data => <DebugAssemblyView ctx={data} sessionId={sessionId} />}
      </DiagnosticPanel>

      <DiagnosticPanel groupId={groupId} id="manifests" active={tab === 'manifests'} resource={manifests}>
        {data => <DebugManifests manifests={data} />}
      </DiagnosticPanel>

      <DiagnosticPanel groupId={groupId} id="scenes" active={tab === 'scenes'} resource={scenes}>
        {data => <DebugScenes scenes={data} />}
      </DiagnosticPanel>
    </div>
  )
}

export default function ContextDebug() {
  const sessions = useDebugRead(listSessions, undefined)
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<Tab>('assembly')
  const firstId = sessions.data?.[0]?.id
  useEffect(() => {
    if (firstId) setSelectedId(id => id || firstId)
  }, [firstId])
  const current = sessions.data?.find(session => session.id === (selectedId || firstId))
  const options = useMemo(() => (sessions.data ?? []).map(session => ({
    value: session.id,
    label: session.title || '未命名会话',
    description: session.id,
    icon: <AppIcon name="chat" size={15} className="shrink-0" />,
  })), [sessions.data])

  return (
    <PortalAppearanceContext value="slime-surface ctx-debug-popover">
      <div className="ctx-debug">
        {options.length > 0 && (
          <div className="ctx-debug-session">
            <div className="ctx-debug-picker">
              <span>会话</span>
              <Select
                label="调试会话"
                searchable
                value={current?.id ?? ''}
                options={options}
                onChange={setSelectedId}
              />
            </div>
            {current && (
              <div className="ctx-debug-session-id">
                <span>会话 ID</span>
                <code>{current.id}</code>
              </div>
            )}
          </div>
        )}
        <LoadState
          loading={sessions.loading && sessions.data === null}
          error={sessions.error}
          hasData={sessions.data !== null}
          onRetry={sessions.retry}
          label="会话列表"
          stale="会话选择器暂时保留上次读取的列表。"
        />
        {!sessions.loading && !sessions.error && !current && (
          <div className="ctx-debug-empty">
            <p role="status">{options.length > 0 ? '所选会话已不在列表中，请重新选择。' : '暂无可调试的会话。'}</p>
            <button type="button" className="ctx-debug-button" onClick={sessions.retry}>重新读取会话</button>
          </div>
        )}
        {current && (
          <DebugSession
            key={current.id}
            sessionId={current.id}
            tab={tab}
            onTab={setTab}
            onRefreshSessions={sessions.retry}
            refreshingSessions={sessions.loading}
          />
        )}
      </div>
    </PortalAppearanceContext>
  )
}
