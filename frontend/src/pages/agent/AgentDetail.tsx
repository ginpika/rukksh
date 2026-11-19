import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  ApiError,
  createMaPeer,
  createPeerAnchor,
  deleteMaPeer,
  deletePeerAnchor,
  getPeerAnchor,
  getSettings,
  listMaPeers,
  updateMaPeer,
  type MaPeer,
  type MaPeerAnchor,
  type ModelView,
} from '../../api/client'
import { CODING_AGENT_ID, CORE_AGENT_ID } from '../../api/agentRuntime'
import { AppIcon, type AppIconName } from '../../components/AppIcon'
import GraphMini from '../../components/GraphMini'
import PageBoundary from '../../components/PageBoundary'
import PeerAvatar from '../../components/PeerAvatar'
import Toast from '../../components/Toast'
import TtsPanel from '../../components/TtsPanel'
import { resetWindowStates, useDraftState, useRememberedState } from '../../components/windowState'
import AgentBackground, { SUB_TABS, type SubView } from '../AgentBackground'
import PromptsPanel from '../PromptsPanel'
import AgentTasks from '../coding/AgentTasks'
import './agentDetail.css'

/** 路径末段用 new 表示「新建成员」（成员 id 是 uuid，不会撞） */
const NEW_ID = 'new'

/** 角色标签的默认色：新建成员、或没挑过颜色时用它（中性灰，不抢眼） */
const DEFAULT_ROLE_COLOR = '#6b7280'

type MainTab = 'prompt' | 'tts' | 'runtime' | 'anchor' | 'coding'
type RightTab = Exclude<MainTab, 'runtime'> | SubView
type TabItem<T extends string> = { key: T; label: string; icon?: AppIconName }
type PanelInfo = { icon: AppIconName; title: string; description: string }

const PANELS: Record<RightTab, PanelInfo> = {
  prompt: { icon: 'doc', title: '提示词与上下文', description: '管理提示词的生效版本，按模型接收的顺序编排上下文。' },
  tts: { icon: 'dictation', title: '语音配置', description: '选择用于朗读回复的语音档案。使用默认档案时，语音随系统设置更新。' },
  heartbeat: { icon: 'clock', title: '心跳', description: '设置后台唤醒的频率和提示词，或手动触发一次心跳。' },
  plans: { icon: 'todo', title: '常驻职责', description: '管理对话中建立的长期职责，查看调度用量和执行记录。' },
  actions: { icon: 'stats', title: '行动日志', description: '查看心跳、常驻职责和子代理的执行记录。' },
  rag: { icon: 'search', title: 'RAG 召回', description: '查看检索查询和实际注入上下文的资料。' },
  anchor: { icon: 'graph', title: '图谱人格锚点', description: '在知识图谱中绑定一个代表该智能体的实体，并查看与它直接相连的关系。' },
  coding: { icon: 'code', title: '编程任务', description: '查看编程任务的进度，配置用于探索、规划和审阅的内置子 Agent。' },
}

const BASE_TABS: TabItem<MainTab>[] = [
  { key: 'prompt', label: '提示词', icon: PANELS.prompt.icon },
  { key: 'tts', label: '语音', icon: PANELS.tts.icon },
  { key: 'runtime', label: '后台运行', icon: 'system' },
  { key: 'anchor', label: '图谱锚点', icon: PANELS.anchor.icon },
]
const CORE_TABS: TabItem<MainTab>[] = [...BASE_TABS, { key: 'coding', label: '编程任务', icon: PANELS.coding.icon }]

function isRuntimeTab(tab: RightTab): tab is SubView {
  return SUB_TABS.some(item => item.key === tab)
}

function TabList<T extends string>({ id, label, items, active, onChange, secondary }: {
  id: string
  label: string
  items: readonly TabItem<T>[]
  active: T
  onChange: (key: T) => void
  secondary?: boolean
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex(item => item.key === active)
    let next: number
    switch (event.key) {
      case 'ArrowLeft':
        next = (index + items.length - 1) % items.length
        break
      case 'ArrowRight':
        next = (index + 1) % items.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = items.length - 1
        break
      default: return
    }
    event.preventDefault()
    event.currentTarget.querySelectorAll('button')[next]?.focus()
    onChange(items[next].key)
  }

  return (
    <div className={secondary ? 'ad-segments' : 'ad-tabs'} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map(item => (
        <button
          key={item.key}
          id={`${id}-${item.key}`}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          aria-controls={`${id}-panel`}
          tabIndex={active === item.key ? 0 : -1}
          onClick={() => onChange(item.key)}
        >
          {item.icon && <AppIcon name={item.icon} size={16} />}
          {item.label}
        </button>
      ))}
    </div>
  )
}

function PanelHeading({ icon, title, description }: PanelInfo) {
  return (
    <header className="ad-panel-head">
      <span className="ad-panel-head__icon"><AppIcon name={icon} size={21} /></span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  )
}

function PanelEmpty({ icon, title, children, action }: {
  icon: AppIconName
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="ad-panel-empty">
      <AppIcon name={icon} size={23} />
      <p className="ad-panel-empty__title">{title}</p>
      <p>{children}</p>
      {action}
    </div>
  )
}

type Draft = {
  name: string
  modelId: string
  note: string
  role: string
  roleColor: string
  avatar: string | null
}

function errMsg(error: unknown): string {
  if (error instanceof ApiError) {
    const raw = error.body?.trim()
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { message?: string }
        if (parsed.message) return parsed.message
      } catch {
        /* 非 JSON：原样展示 */
      }
      return raw
    }
    return `请求失败（${error.status}）`
  }
  return error instanceof Error ? error.message : String(error)
}

/** 头像存的是文本，先裁成方图并压到 256px，避免把整张原图塞进成员表 */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const side = 256
      const canvas = document.createElement('canvas')
      canvas.width = side
      canvas.height = side
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('这个浏览器不支持图片处理'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, side, side)
      const scale = Math.max(side / image.width, side / image.height)
      const width = image.width * scale
      const height = image.height * scale
      ctx.drawImage(image, (side - width) / 2, (side - height) / 2, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('这张图读不出来，换一张试试'))
    }
    image.src = objectUrl
  })
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="ad-field">
      <span className="ad-field__label">{label}</span>
      {children}
      {hint && <span className="ad-field__hint">{hint}</span>}
    </div>
  )
}

function RoleColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="ad-color" title="角色标签颜色">
      <span className="ad-color__dot" style={{ background: value }} aria-hidden="true" />
      <input
        type="color"
        aria-label="角色标签颜色"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/** 图谱人格锚点：成员与知识图谱锚点实体的绑定 + 该锚点的 1 跳子图 */
function PeerAnchorPanel({
  peerId,
  peerName,
  notify,
}: {
  peerId: string
  peerName: string
  notify: (message: string, kind?: 'ok' | 'err') => void
}) {
  const [view, setView] = useState<MaPeerAnchor | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const result = await getPeerAnchor(peerId)
        if (alive) setView(result)
      } catch (error) {
        if (alive) setLoadError(errMsg(error))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [peerId, loadAttempt])

  const create = async () => {
    setBusy(true)
    try {
      setView(await createPeerAnchor(peerId))
      notify(`已为「${peerName}」建立图谱人格锚点`, 'ok')
    } catch (error) {
      notify(errMsg(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const unbind = async () => {
    if (!window.confirm(`解除「${peerName}」的图谱人格锚点？锚点实体及其关系会保留在知识图谱中。`)) return
    setBusy(true)
    try {
      setView(await deletePeerAnchor(peerId))
      notify('已解除图谱人格锚点', 'ok')
    } catch (error) {
      notify(errMsg(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const anchor = view?.anchor ?? null
  const graph = view?.graph ?? { nodes: [], edges: [] }

  if (loading) return <p className="ad-empty" role="status">载入锚点…</p>

  if (loadError) return (
    <PanelEmpty icon="alert" title="无法读取图谱锚点" action={
      <button type="button" className="ad-btn" onClick={() => {
        setLoading(true)
        setLoadError('')
        setLoadAttempt(attempt => attempt + 1)
      }}>重试</button>
    }>
      <span role="alert">{loadError}</span>
    </PanelEmpty>
  )

  if (!anchor) return (
    <PanelEmpty icon="graph" title="尚未绑定锚点" action={
      <button type="button" className="ad-btn ad-btn--primary" disabled={busy} onClick={() => void create()}>
        <AppIcon name="plus" size={15} />
        {busy ? '建立中…' : '新建图谱人格锚点'}
      </button>
    }>
      建立后会以「{peerName}」为名在图谱中创建一个锚点实体。
    </PanelEmpty>
  )

  return (
    <section className="ad-section" aria-label="已绑定锚点">
      <div className="ad-section-head">
        <div>
          <h3>{anchor.name}</h3>
          <p className="ad-hint">{anchor.type} · 相邻实体 {Math.max(graph.nodes.length - 1, 0)} 个 · 关系 {graph.edges.length} 条</p>
        </div>
        <div className="ad-head-actions">
          <a className="ad-btn" href={`#/graph?entity=${encodeURIComponent(anchor.id)}`}>
            在图谱中打开 <AppIcon name="external" size={14} />
          </a>
          <button type="button" className="ad-btn" disabled={busy} onClick={() => void unbind()}>解除锚点</button>
        </div>
      </div>
      <div className="ad-graph">
        <GraphMini nodes={graph.nodes} edges={graph.edges} emphasized={new Set([anchor.id])} className="h-full w-full" />
      </div>
      {graph.edges.length === 0 && <p className="ad-hint">可在图谱中为锚点添加关系。</p>}
    </section>
  )
}

export default function AgentDetail({ peerId: requestedPeerId }: { peerId: string }) {
  const peerId = requestedPeerId === CODING_AGENT_ID ? CORE_AGENT_ID : requestedPeerId
  const isNew = peerId === NEW_ID
  const coreAgent = peerId === CORE_AGENT_ID

  const [peer, setPeer] = useState<MaPeer | null>(null)
  const [loading, setLoading] = useState(true)
  const [models, setModels] = useState<ModelView[]>([])
  const [toast, setToast] = useState<{ msg: string; kind?: 'ok' | 'err' } | null>(null)

  const [draft, setDraft, draftState] = useDraftState<Draft | null>(`agent:${peerId}:profile`, null)
  const initializeDraft = draftState.initialize
  const [savingProfile, setSavingProfile] = useRememberedState(`agent:${peerId}:saving`, false)
  const [selectedTab, setTab] = useRememberedState<RightTab>(`agent:${peerId}:tab`, 'prompt')
  const [lastRuntime, setLastRuntime] = useRememberedState<SubView>(`agent:${peerId}:runtime`, 'heartbeat')
  const [profileOpen, setProfileOpen] = useState(false)
  const tabsId = useId()
  const runtimeId = useId()
  const profileId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const loadedIdRef = useRef<string | null>(null)

  const notify = useCallback((msg: string, kind?: 'ok' | 'err') => setToast({ msg, kind }), [])

  const reloadPeer = useCallback(async () => {
    if (isNew) return
    try {
      const list = await listMaPeers()
      setPeer(list.find((item) => item.id === peerId) ?? null)
    } catch (error) {
      notify(errMsg(error), 'err')
    }
  }, [isNew, peerId, notify])

  const loadSettings = useCallback(async () => {
    try {
      const settings = await getSettings()
      setModels(settings.models)
    } catch (error) {
      notify(errMsg(error), 'err')
    }
  }, [notify])

  useEffect(() => {
    void (async () => {
      await Promise.all([reloadPeer(), loadSettings()])
      setLoading(false)
    })()
  }, [reloadPeer, loadSettings])

  useEffect(() => {
    if (isNew) {
      initializeDraft({
        name: '', modelId: '', note: '', role: '', roleColor: DEFAULT_ROLE_COLOR,
        avatar: null,
      })
      return
    }
    if (!peer || loadedIdRef.current === peer.id) return
    loadedIdRef.current = peer.id
    initializeDraft({
      name: peer.name,
      modelId: peer.modelId ?? '',
      note: peer.note ?? '',
      role: peer.role ?? '',
      roleColor: peer.roleColor ?? DEFAULT_ROLE_COLOR,
      avatar: peer.avatar,
    })
  }, [peer, isNew, initializeDraft])

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      setDraft((current) => (current ? { ...current, avatar: dataUrl } : current))
    } catch (error) {
      notify(errMsg(error), 'err')
    }
  }

  const saveProfile = async () => {
    if (!draft || savingProfile) return
    const name = draft.name.trim()
    if (!name) {
      notify('先给成员起个名字（它会用在 @ 里）', 'err')
      return
    }
    setSavingProfile(true)
    try {
      if (peer) {
        await updateMaPeer(peer.id, {
          name,
          modelId: draft.modelId,
          note: draft.note,
          role: draft.role,
          roleColor: draft.roleColor,
          avatar: draft.avatar ?? '',
        })
        draftState.accept({ ...draft, name }, draft)
        notify(`「${name}」的资料已保存`, 'ok')
        await reloadPeer()
      } else {
        const created = await createMaPeer({
          name,
          modelId: draft.modelId,
          note: draft.note,
          role: draft.role,
          roleColor: draft.roleColor,
          avatar: draft.avatar ?? undefined,
        })
        draftState.accept(null, draft)
        window.location.assign(`#/multi-agent/${encodeURIComponent(created.id)}`)
      }
    } catch (error) {
      notify(errMsg(error), 'err')
    } finally {
      setSavingProfile(false)
    }
  }

  const remove = async () => {
    if (!peer) return
    if (!window.confirm(`把「${peer.name}」移出圆桌？`)) return
    try {
      await deleteMaPeer(peer.id)
      resetWindowStates(`agent:${peer.id}:`, `prompt:${peer.id}:`, `prompts:${peer.id}:`)
      window.location.assign('#/multi-agent')
    } catch (error) {
      notify(errMsg(error), 'err')
    }
  }

  if (loading) {
    return <div className="ad-page"><p className="ad-empty" role="status">载入成员资料…</p></div>
  }

  if (!isNew && !peer) {
    return (
      <div className="ad-page">
        <p className="ad-empty">这位成员不存在，或已被移出圆桌。</p>
        <a className="ad-btn" href="#/multi-agent">返回成员列表</a>
      </div>
    )
  }

  const preview = draft?.name?.trim() || peer?.name || (isNew ? '新成员' : '成员')
  const roleValue = draft?.role?.trim() ?? ''
  const roleColor = draft?.roleColor || DEFAULT_ROLE_COLOR
  const modelName = models.find((model) => model.id === draft?.modelId)?.name
  const tab = Object.hasOwn(PANELS, selectedTab) ? selectedTab : 'prompt'
  const runtimeTab = isRuntimeTab(tab) ? tab : null
  const mainTab = isRuntimeTab(tab) ? 'runtime' : tab
  const heading = PANELS[tab]

  return (
    <div className={isNew ? 'ad-page ad-page--new' : 'ad-page'} data-page="agent">
      <header className="ad-hero">
        <div className="ad-hero__identity">
          <PeerAvatar name={preview} avatar={draft?.avatar ?? null} size="h-14 w-14" textClass="text-xl" />
          <div className="ad-hero__text">
            <div className="ad-hero__title">
              <h1>{preview}</h1>
              {coreAgent && <span className="ad-tag">系统主控</span>}
              {!coreAgent && peer?.builtin && <span className="ad-tag">内置</span>}
              {roleValue && (
                <span className="ad-role"><i style={{ background: roleColor }} aria-hidden="true" />{roleValue}</span>
              )}
            </div>
            <p className="ad-hero__meta"><AppIcon name="system" size={14} />{modelName ?? '跟随默认模型'}</p>
          </div>
        </div>
        <div className="ad-hero__actions">
          {coreAgent && <a className="ad-btn" href="#/coding">编程工作台 <AppIcon name="external" size={14} /></a>}
          <button
            type="button"
            className="ad-btn ad-btn--primary"
            disabled={savingProfile}
            onClick={() => void saveProfile()}
          >
            {savingProfile ? '保存中…' : peer ? '保存资料' : '加入圆桌'}
          </button>
        </div>
      </header>

      {draftState.dirty && (
        <div className="ad-dirty" role="status">
          <span>成员资料有未保存的修改</span>
          <button type="button" className="ad-linkbtn" disabled={savingProfile} onClick={draftState.discard}>
            放弃修改
          </button>
        </div>
      )}

      <PageBoundary>
        <div className="ad-layout">
          <aside className="ad-profile" aria-label="成员资料" data-open={isNew ? undefined : profileOpen}>
            <h2 className="ad-profile__heading"><AppIcon name="agent" size={16} />成员资料</h2>
            {!isNew && (
              <button
                type="button"
                className="ad-profile__toggle"
                aria-expanded={profileOpen}
                aria-controls={profileId}
                onClick={() => setProfileOpen(open => !open)}
              >
                <AppIcon name="agent" size={16} />成员资料<AppIcon name="chevron-down" size={16} className="ad-profile__chevron" />
              </button>
            )}
            <div className="ad-profile__body" id={profileId}>
              <div className="ad-avatar">
                <button
                  type="button"
                  className="ad-avatar__button"
                  title="点击上传头像"
                  aria-label="上传或更换头像"
                  onClick={() => fileRef.current?.click()}
                >
                  <PeerAvatar name={preview} avatar={draft?.avatar ?? null} size="h-12 w-12" textClass="text-lg" />
                  <span className="ad-avatar__overlay">更换</span>
                </button>
                <div className="ad-avatar__meta">
                  <div className="ad-avatar__actions">
                    <button type="button" className="ad-linkbtn" onClick={() => fileRef.current?.click()}>上传头像</button>
                    {draft?.avatar && (
                      <button
                        type="button"
                        className="ad-linkbtn"
                        onClick={() => setDraft((current) => (current ? { ...current, avatar: null } : current))}
                      >
                        移除
                      </button>
                    )}
                  </div>
                  <p className="ad-hint">自动裁成方图并压缩</p>
                </div>
              </div>

              <Field label="名字" hint="发言时被 @ 的名字，圆桌上唯一">
                <input
                  className="ad-input"
                  aria-label="名字"
                  value={draft?.name ?? ''}
                  placeholder="如：张三"
                  onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                />
              </Field>

              <Field label="角色" hint="执行态卡片右上角的小标签；留空则不显示">
                <span className="ad-inline">
                  <input
                    className="ad-input"
                    aria-label="角色"
                    value={draft?.role ?? ''}
                    placeholder="如：产品经理"
                    onChange={(event) => setDraft((current) => (current ? { ...current, role: event.target.value } : current))}
                  />
                  <RoleColorPicker
                    value={roleColor}
                    onChange={(value) => setDraft((current) => (current ? { ...current, roleColor: value } : current))}
                  />
                </span>
              </Field>

              <Field label="模型" hint="不指定则跟随设置页默认">
                <select
                  className="ad-input"
                  aria-label="模型"
                  value={draft?.modelId ?? ''}
                  onChange={(event) => setDraft((current) => (current ? { ...current, modelId: event.target.value } : current))}
                >
                  <option value="">跟随设置页默认</option>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </Field>

              <Field label="备注" hint="写给人看的一句话，不会注入模型">
                <textarea
                  className="ad-input ad-textarea"
                  aria-label="备注"
                  rows={3}
                  value={draft?.note ?? ''}
                  placeholder="如：负责挑刺的那位"
                  onChange={(event) => setDraft((current) => (current ? { ...current, note: event.target.value } : current))}
                />
              </Field>

              {peer && !peer.builtin && (
                <div className="ad-danger">
                  <button type="button" className="ad-btn ad-btn--danger" onClick={() => void remove()}>移出圆桌</button>
                  <p className="ad-hint">移出后，它自己那套提示词（版本 / 生效项 / 顺序）会一并清除。</p>
                </div>
              )}
            </div>
          </aside>

          {peer && (
            <section className="ad-main" aria-label="成员配置">
              <TabList<MainTab>
                id={tabsId}
                label="配置分类"
                items={coreAgent ? CORE_TABS : BASE_TABS}
                active={mainTab}
                onChange={key => setTab(key === 'runtime' ? lastRuntime : key)}
              />
              <div
                className="ad-panel"
                id={`${tabsId}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabsId}-${mainTab}`}
                tabIndex={runtimeTab ? undefined : 0}
              >
                {runtimeTab ? (
                  <>
                    <TabList<SubView>
                      id={runtimeId}
                      label="后台运行"
                      items={SUB_TABS}
                      active={runtimeTab}
                      onChange={key => {
                        setLastRuntime(key)
                        setTab(key)
                      }}
                      secondary
                    />
                    <div className="ad-runtime-panel" id={`${runtimeId}-panel`} role="tabpanel" aria-labelledby={`${runtimeId}-${runtimeTab}`} tabIndex={0}>
                      <PanelHeading {...heading} />
                      <AgentBackground peerId={peer.id} peerName={peer.name} models={models} view={runtimeTab} hideTabs />
                    </div>
                  </>
                ) : <PanelHeading {...heading} />}

                {coreAgent && tab === 'coding' && <AgentTasks />}
                {tab === 'tts' && <TtsPanel agentId={peer.id} embedded />}
                {tab === 'anchor' && <PeerAnchorPanel peerId={peer.id} peerName={peer.name} notify={notify} />}
                {tab === 'prompt' && <PromptsPanel peerId={peer.id} embedded />}
              </div>
            </section>
          )}
        </div>
      </PageBoundary>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => void onFile(event)}
      />

      <Toast message={toast?.msg ?? null} kind={toast?.kind === 'err' ? 'error' : 'success'} onClose={() => setToast(null)} />
    </div>
  )
}
