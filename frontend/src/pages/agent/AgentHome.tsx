/** The everyday Slime surface. Existing specialist tools live in Dashboard. */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, BookOpen, Check, ChevronDown, Copy, History, MessageSquare, PanelLeftOpen, PenLine, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import { ApiError, createSession, getSettings, listMaPeers, listSessions, sessionMessages, sessionPreviews, updateSessionConfig, type MaPeer, type ReasoningEffort, type SessionItem, type SessionMessage, type SettingsView } from '../../api/client'
import { CORE_AGENT_ID, isCodingAgent, sortAgentPeers } from '../../api/agentRuntime'
import { AppIcon } from '../../components/AppIcon'
import AgentMessageReceipt from '../../components/AgentMessageReceipt'
import ChatMarkdown from '../../components/ChatMarkdown'
import UserQuestionCard from '../../components/UserQuestionCard'
import { SlimeAppearanceButton } from '../../components/SlimeAppearance'
import { useRememberedState } from '../../components/windowState'
import { registerChatOpener } from '../../components/ChatNotifier'
import { subscribeSessionEvents } from '../../components/sessionEvents'
import { AGENT_MESSAGE_SENT, backfillSettledReply, isBackgroundReply, mergeAgentMessageReceipts, mergeLiveChat } from '../../components/settledChat'
import { questionTurn } from '../../components/userQuestion'
import { attachLive, clearLive, getLive, setActiveChatSession, startChat, steerActiveChat, stopChat, useLiveChat, type ChatMsg, type LiveChat } from '../../components/chatLive'
import { BRAND } from '../../branding'
import AgentSidebar, { type AgentPreview } from './AgentSidebar'
import ComposerActivity from './ComposerActivity'
import ComposerModelPicker from './ComposerModelPicker'
import { useDictation } from './useDictation'
import { useWelcomeSlogan } from './useWelcomeSlogan'
import './agent.css'

const LAST_SESSION_KEY = 'minis.agent.lastSession'
type ComposerDrafts = Record<string, string>
const sessionDraftKey = (id: string) => `session:${id}`
const newDraftKey = (agentId: string | null) => `new:${agentId ?? CORE_AGENT_ID}`

function writeComposerDraft(drafts: ComposerDrafts, key: string, value: string): ComposerDrafts {
  if ((drafts[key] ?? '') === value) return drafts
  const next = { ...drafts }
  if (value) next[key] = value
  else delete next[key]
  return next
}

type ViewMsg = ChatMsg & { at?: string | null }
type ComposerPreference = { modelId: string; effort?: ReasoningEffort }
const SUGGESTIONS = [
  { icon: Sparkles, label: '理清思路', text: '我有一个想法，想和你一起理一理。' },
  { icon: BookOpen, label: '整理资料', text: '帮我总结知识库里最近的文档，提炼重点。' },
  { icon: PenLine, label: '写点东西', text: '我想写点东西，帮我一起打磨。' },
]
function toViewMsg(row: SessionMessage): ViewMsg {
  return { id: row.id, role: row.role === 'user' ? 'user' : 'assistant', content: row.content,
    reasoning: row.reasoning ?? undefined, trace: row.trace ?? undefined, kind: row.kind ?? undefined,
    subagent: row.subagent ?? undefined, at: row.createdAt }
}
function dayBucket(iso: string | null): string {
  if (!iso) return '更早'
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const time = new Date(iso).getTime()
  return time >= today.getTime() ? '今天' : time >= yesterday.getTime() ? '昨天' : '更早'
}
function sessionTitle(session: SessionItem): string { return session.title?.trim() || '新对话' }
function agentOf(session: SessionItem): string | null { return !session.agentId || session.agentId === CORE_AGENT_ID ? null : session.agentId }
function previewSnippet(value?: string | null): string | undefined {
  return value?.replace(/\s+/g, ' ').trim().slice(0, 220) || undefined
}

/** 手机端点气泡进全屏阅读时，气泡内的链接、按钮、表单控件与正在进行的文本选择保持原行为。 */
function canExpandBubble(event: ReactMouseEvent<HTMLElement>): boolean {
  const selection = window.getSelection()
  /* 只让行「在这只气泡里」的选择：别处的残留选区不该把点按吞掉 */
  if (selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) return false
  const target = event.target
  return !(target instanceof Element && target.closest(
    'a, button, input, textarea, select, summary, label, [contenteditable="true"], [role="button"]',
  ))
}

/** 全屏阅读层在历史栈里那一格的标记：手机返回手势先消费这一格，不会直接退出页面。 */
const READER_HISTORY_KEY = 'minisAgentReader'
export default function AgentHome({ connErr, userSlot }: { connErr?: string | null; userSlot?: ReactNode }) {
  const { slogan, randomize: randomizeSlogan } = useWelcomeSlogan()
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [peers, setPeers] = useState<MaPeer[]>([])
  const [peersLoading, setPeersLoading] = useState(true)
  const [peersError, setPeersError] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [selectedAgentId, setSelectedAgentId] = useRememberedState<string | null>('agent:home-selection', null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState(false)
  const [modelId, setModelId] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | undefined>(undefined)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<ViewMsg[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [drafts, setDrafts] = useRememberedState<ComposerDrafts>('agent:composer-drafts', {})
  const draftKey = sessionId ? sessionDraftKey(sessionId) : newDraftKey(selectedAgentId)
  const text = drafts[draftKey] ?? ''
  const setText = useCallback((action: SetStateAction<string>) => {
    setDrafts(current => {
      const value = typeof action === 'function' ? action(current[draftKey] ?? '') : action
      return writeComposerDraft(current, draftKey, value)
    })
  }, [draftKey, setDrafts])
  const [query, setQuery] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  /** 手机端点开的气泡：全屏阅读层的数据（null=未打开）；桌面布局不启用。 */
  const [reader, setReader] = useState<{ message: ViewMsg; index: number } | null>(null)
  const readerRef = useRef<HTMLElement>(null)
  const readerCloseRef = useRef<HTMLButtonElement>(null)
  const readerTriggerRef = useRef<HTMLElement | null>(null)
  /** 历史栈顶是不是阅读层压入的那一格（用于区分主动关闭与手机返回手势）。 */
  const readerHistoryActive = useRef(false)
  /** 收起全屏阅读层：有历史格就后退一格把页面交还给对话，没有则只关层。 */
  const closeReader = useCallback(() => {
    if (readerHistoryActive.current) {
      readerHistoryActive.current = false
      window.history.back()
    }
    setReader(null)
  }, [])
  const [sessionsError, setSessionsError] = useState(false)
  const [messageError, setMessageError] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const sidebarOpen = !narrow || drawerOpen
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const live = useLiveChat(sessionId)
  const busy = live?.running ?? false
  const currentRef = useRef<string | null>(null)
  const selectedAgentRef = useRef(selectedAgentId)
  const sessionsRef = useRef<SessionItem[]>([])
  const sessionsVersion = useRef(0)
  const settledRef = useRef<LiveChat | null>(null)
  const creatingRef = useRef(false)
  const historyVersion = useRef(0)
  const followBottom = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const copyTimer = useRef<number | undefined>(undefined)
  const historyRef = useRef<HTMLDivElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const composerPreferences = useRef(new Map<string, ComposerPreference>())
  const preferenceRef = useRef<ComposerPreference>({ modelId: '' })
  preferenceRef.current = { modelId, effort: reasoningEffort }
  const moreRef = useRef<HTMLDetailsElement>(null)
  const dictationOwner = useRef<string | null>(null)
  const dictation = useDictation({
    onText: transcript => {
      const owner = currentRef.current ?? `new:${selectedAgentRef.current ?? CORE_AGENT_ID}`
      if (dictationOwner.current !== owner) return
      setText(previous => `${previous}${previous && !/\s$/.test(previous) ? ' ' : ''}${transcript}`)
    },
    onError: setToast,
  })
  useEffect(() => {
    if (document.activeElement === document.body) mainRef.current?.focus({ preventScroll: true })
    return () => {
      historyVersion.current++
      sessionsVersion.current++
    }
  }, [])
  const toggleDictation = () => {
    if (!dictation.listening) dictationOwner.current = currentRef.current ?? `new:${selectedAgentRef.current ?? CORE_AGENT_ID}`
    dictation.toggle()
  }
  useEffect(() => {
    dictation.stop()
    if (moreRef.current) moreRef.current.open = false
  }, [sessionId, selectedAgentId, dictation.stop])
  useEffect(() => {
    const closeMore = (event: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) moreRef.current.open = false
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && moreRef.current) moreRef.current.open = false }
    document.addEventListener('pointerdown', closeMore)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', closeMore); document.removeEventListener('keydown', escape) }
  }, [])

  const rememberPreferences = useCallback(() => {
    composerPreferences.current.set(currentRef.current ?? `new:${selectedAgentRef.current ?? CORE_AGENT_ID}`, preferenceRef.current)
  }, [])
  const restorePreferences = useCallback((key: string, fallbackModelId = '') => {
    const preference = composerPreferences.current.get(key) ?? { modelId: fallbackModelId }
    preferenceRef.current = preference
    setModelId(preference.modelId); setReasoningEffort(preference.effort)
  }, [])
  const reloadSettings = useCallback(() => {
    setSettingsLoading(true)
    void getSettings().then(value => { setSettings(value); setSettingsError(false) })
      .catch(() => setSettingsError(true)).finally(() => setSettingsLoading(false))
  }, [])
  useEffect(reloadSettings, [reloadSettings])

  const selectIdentity = useCallback((id: string | null) => {
    selectedAgentRef.current = id
    setSelectedAgentId(id)
  }, [setSelectedAgentId])
  const reloadPeers = useCallback(() => {
    setPeersLoading(true)
    void listMaPeers().then(list => { setPeers(sortAgentPeers(list)); setPeersError(false) })
      .catch(() => setPeersError(true)).finally(() => setPeersLoading(false))
  }, [])
  useEffect(reloadPeers, [reloadPeers])

  const reloadSessions = useCallback(() => {
    const version = ++sessionsVersion.current
    void listSessions().then(list => {
      if (sessionsVersion.current !== version) return
      sessionsRef.current = list; setSessions(list); setSessionsError(false)
    }).catch(() => { if (sessionsVersion.current === version) setSessionsError(true) })
    void sessionPreviews().then(result => { if (sessionsVersion.current === version) setPreviews(result) })
      .catch(() => { /* Older backends can still show a conversation title. */ })
  }, [])
  useEffect(reloadSessions, [reloadSessions])
  /* 手机系统返回（含全面屏手势）：消费阅读层压入的历史格，先收起全屏层。
     监听常驻组件生命周期；只有阅读层自己那格在栈顶时才处理，普通返回交给浏览器。 */
  useEffect(() => {
    const onPopState = () => {
      if (!readerHistoryActive.current) return
      readerHistoryActive.current = false
      setReader(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const change = () => {
      setNarrow(media.matches)
      setDrawerOpen(false)
      /* 全屏阅读只服务手机布局：拉宽窗口时收起，避免阅读层悬挂在桌面布局上 */
      if (!media.matches) closeReader()
    }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [closeReader])

  /* 阅读层打开期间：锁住背景滚动、Esc 收起、Tab 在层内循环，关闭后把焦点还给被点的那只气泡。 */
  useEffect(() => {
    if (!reader) return
    const trigger = readerTriggerRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeReader()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(readerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter(element => element.offsetParent !== null)
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const raf = requestAnimationFrame(() => readerCloseRef.current?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [closeReader, reader])

  const closeSidebar = useCallback(() => {
    setDrawerOpen(false)
    if (window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => menuRef.current?.focus({ preventScroll: true }))
    }
  }, [])

  const closeNarrowSidebar = useCallback(() => {
    if (!window.matchMedia('(max-width: 760px)').matches) return
    if (sideRef.current?.contains(document.activeElement)) closeSidebar()
    else setDrawerOpen(false)
  }, [closeSidebar])

  const openSession = useCallback((id: string) => {
    if (creatingRef.current) return
    closeReader()
    rememberPreferences()
    const snapshot = getLive(id)
    const settled = snapshot && !snapshot.running ? snapshot : null
    if (settled) clearLive(id)
    const known = sessionsRef.current.find(session => session.id === id)
    if (known) selectIdentity(agentOf(known))
    restorePreferences(id, known?.modelId ?? '')
    setHistoryOpen(false)
    currentRef.current = id
    const version = ++historyVersion.current
    setSessionId(id); setMsgs([]); setLoading(true); setMessageError(false)
    followBottom.current = true; setAwayFromBottom(false)
    window.localStorage.setItem(LAST_SESSION_KEY, id)
    closeNarrowSidebar()
    // Notifications and restoration can arrive before the session list. Resolve
    // the Agent before exposing the conversation as ready for another message.
    const identity = known ? Promise.resolve(known) : listSessions().then(list => {
      const found = list.find(session => session.id === id)
      if (!found) throw new Error('会话不存在')
      if (currentRef.current === id && historyVersion.current === version) {
        sessionsRef.current = list; setSessions(list)
      }
      return found
    })
    void Promise.all([sessionMessages(id), identity]).then(([rows, session]) => {
      if (currentRef.current !== id || historyVersion.current !== version) return
      selectIdentity(agentOf(session))
      restorePreferences(id, session.modelId ?? '')
      const history = rows.map(toViewMsg)
      setMsgs(settled?.error ? mergeLiveChat(history, settled) : history)
      if (settled?.error) setToast(`上次回复未完成：${settled.error}`)
      setSessions(list => list.map(s => s.id === id ? { ...s, unread: false } : s))
    }).catch(() => {
      if (currentRef.current !== id || historyVersion.current !== version) return
      if (settled) { setMsgs(mergeLiveChat([], settled)); setToast('暂时无法加载完整历史，已保留最近的回复') }
      else setMessageError(true)
    }).finally(() => {
      if (currentRef.current === id && historyVersion.current === version) setLoading(false)
    })
    if (!snapshot) void attachLive(id)
  }, [closeReader, closeNarrowSidebar, selectIdentity, rememberPreferences, restorePreferences])

  useEffect(() => {
    const session = sessions.find(item => item.id === sessionId)
    if (session) selectIdentity(agentOf(session))
  }, [sessions, sessionId, selectIdentity])

  useEffect(() => {
    const last = window.localStorage.getItem(LAST_SESSION_KEY)
    if (last) openSession(last)
  }, [openSession])
  useEffect(() => {
    registerChatOpener(openSession)
    return () => registerChatOpener(null)
  }, [openSession])

  const newChat = useCallback(() => {
    if (creatingRef.current) return
    closeReader()
    const active = currentRef.current ? sessionsRef.current.find(session => session.id === currentRef.current) : null
    if (currentRef.current && !active) { setToast('正在读取 Agent 信息，请稍后再试'); return }
    rememberPreferences()
    if (active) selectIdentity(agentOf(active))
    currentRef.current = null; historyVersion.current++
    composerPreferences.current.set(`new:${selectedAgentRef.current ?? CORE_AGENT_ID}`, preferenceRef.current)
    randomizeSlogan()
    setDrafts(current => writeComposerDraft(current, newDraftKey(selectedAgentRef.current), ''))
    setSessionId(null); setMsgs([]); setLoading(false); setMessageError(false)
    setHistoryOpen(false); setQuery('')
    followBottom.current = true; setAwayFromBottom(false)
    window.localStorage.removeItem(LAST_SESSION_KEY)
    setDrawerOpen(false)
    requestAnimationFrame(() => taRef.current?.focus())
  }, [closeReader, selectIdentity, rememberPreferences, randomizeSlogan, setDrafts])

  const selectAgent = useCallback((id: string | null) => {
    if (creatingRef.current) return
    closeReader()
    const peer = peers.find(item => item.id === id)
    if (peer && isCodingAgent(peer)) { window.location.hash = '#/coding'; return }
    const recent = [...sessionsRef.current].filter(session => agentOf(session) === id)
      .sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))[0]
    if (recent) { openSession(recent.id); return }
    rememberPreferences()
    currentRef.current = null; historyVersion.current++
    selectIdentity(id); setSessionId(null); setMsgs([]); setLoading(false); setMessageError(false)
    restorePreferences(`new:${id ?? CORE_AGENT_ID}`)
    randomizeSlogan()
    setHistoryOpen(false); setQuery(''); followBottom.current = true; setAwayFromBottom(false)
    window.localStorage.removeItem(LAST_SESSION_KEY)
    closeNarrowSidebar()
  }, [closeReader, closeNarrowSidebar, peers, openSession, selectIdentity, rememberPreferences, restorePreferences, randomizeSlogan])

  useEffect(() => {
    if (!historyOpen) return
    const onPointer = (event: PointerEvent) => {
      if (!historyRef.current?.contains(event.target as Node) && !historyButtonRef.current?.contains(event.target as Node)) setHistoryOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setHistoryOpen(false); historyButtonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [historyOpen])

  // Keep background delivery visible without replacing a newer turn with a stale history request.
  useEffect(() => subscribeSessionEvents(event => {
    if (event.kind === 'todo') return
    const receipt = event.kind === AGENT_MESSAGE_SENT
    if (!receipt) reloadSessions()
    const id = currentRef.current
    if (!id || event.sessionId !== id || (!receipt && (event.kind !== 'delivered' || getLive(id)?.running))) return
    const version = historyVersion.current
    void sessionMessages(id).then(rows => {
      if (currentRef.current !== id || historyVersion.current !== version) return
      if (receipt) setMsgs(previous => mergeAgentMessageReceipts(previous, rows))
      else if (!getLive(id)?.running) setMsgs(rows.map(toViewMsg))
    }).catch(() => { /* A later delivery or reopening can retry the request. */ })
  }), [reloadSessions])

  useEffect(() => {
    if (!live || live.running || settledRef.current === live || loading) return
    settledRef.current = live
    const id = live.sessionId
    setMsgs(previous => mergeLiveChat(previous, live).filter(m => m.role === 'user' || m.content || m.trace?.length))
    clearLive(id)
    void sessionMessages(id).then(rows => {
      if (currentRef.current !== id || settledRef.current !== live || getLive(id)?.running) return
      setMsgs(previous => backfillSettledReply(previous, live, rows))
    }).catch(() => { /* Retain the completed stream when history is temporarily unavailable. */ })
    reloadSessions()
  }, [live, loading, reloadSessions])
  useEffect(() => { if (live?.error) setToast(`发送失败：${live.error}`) }, [live?.error])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])
  useEffect(() => {
    setActiveChatSession(sessionId)
    return () => setActiveChatSession(null)
  }, [sessionId])

  // On phones the history is an actual drawer, including keyboard focus and Escape handling.
  useEffect(() => {
    if (!drawerOpen || !narrow) return
    const aside = sideRef.current
    aside?.querySelector<HTMLElement>('button, a')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSidebar()
      }
      if (event.key !== 'Tab' || !aside) return
      const items = Array.from(aside.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)'))
        .filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [narrow, drawerOpen, closeSidebar])

  const inheritedAgent = peers.find(peer => peer.id === (selectedAgentId ?? CORE_AGENT_ID))
  const inheritedModelId = inheritedAgent ? inheritedAgent.modelId || settings?.defaultModelId : undefined
  const effectiveModel = settings?.models.find(model => model.id === (modelId || inheritedModelId))
  const supportedEffort = reasoningEffort && effectiveModel?.reasoningEfforts?.includes(reasoningEffort) ? reasoningEffort : undefined
  useEffect(() => {
    if (settings && (modelId || inheritedModelId) && reasoningEffort && !effectiveModel?.reasoningEfforts?.includes(reasoningEffort)) setReasoningEffort(undefined)
  }, [settings, effectiveModel, reasoningEffort, modelId, inheritedModelId])

  const sendText = useCallback(async (raw: string) => {
    const value = raw.trim()
    if (!value || creatingRef.current || loading || messageError) return
    let id = currentRef.current
    const active = getLive(id)
    if (active?.running && (active.stopping || active.userMessageId == null)) return
    creatingRef.current = true; setCreating(true)
    followBottom.current = true; setAwayFromBottom(false)
    const agentId = selectedAgentRef.current
    try {
      if (id && active?.running && active.userMessageId != null) {
        await steerActiveChat(id, active.userMessageId, value)
        setText(current => current === raw ? '' : current)
        return
      }
      if (!id) {
        const created = await createSession()
        if (agentId || modelId) {
          await updateSessionConfig(created.id, { agentId, modelId: modelId || null, promptId: null, showCot: null, showRounds: null })
        }
        id = created.id
        currentRef.current = id; setSessionId(id)
        window.localStorage.setItem(LAST_SESSION_KEY, id)
        const session: SessionItem = { id, title: null, agentId, modelId: modelId || null, promptId: null, projectId: null, showCot: null, showRounds: null, unread: false, generating: false, updatedAt: new Date().toISOString() }
        sessionsRef.current = [session, ...sessionsRef.current]
        setSessions(sessionsRef.current)
      } else if ((sessionsRef.current.find(session => session.id === id)?.modelId ?? '') !== modelId) {
        await updateSessionConfig(id, { agentId: null, modelId: modelId || '', promptId: null, showCot: null, showRounds: null })
        sessionsRef.current = sessionsRef.current.map(session => session.id === id ? { ...session, modelId: modelId || null } : session)
        setSessions(sessionsRef.current)
      }
      historyVersion.current++
      composerPreferences.current.set(id, { modelId, effort: supportedEffort })
      startChat({ sessionId: id, text: value, modelId: modelId || undefined, reasoningEffort: supportedEffort, onSettled: reloadSessions })
      const destination = sessionDraftKey(id)
      setDrafts(current => {
        const latest = current[draftKey] ?? ''
        const remaining = latest === raw ? '' : latest
        return destination === draftKey
          ? writeComposerDraft(current, draftKey, remaining)
          : writeComposerDraft(writeComposerDraft(current, draftKey, ''), destination, remaining)
      })
      reloadSessions()
    } catch (error) {
      if (active?.running) {
        setToast(error instanceof ApiError && error.status === 409
          ? '当前任务状态已变化，请重新发送'
          : '补充消息未能发送，请稍后重试')
      } else {
        setToast('暂时无法发送，请稍后重试')
      }
    } finally { creatingRef.current = false; setCreating(false) }
  }, [loading, messageError, reloadSessions, modelId, supportedEffort, draftKey, setDrafts, setText])

  const view = useMemo(() => live ? mergeLiveChat(msgs, live) : msgs, [live, msgs])
  const empty = !loading && !messageError && view.length === 0
  const latestTurn = view.findLastIndex(m => !isBackgroundReply(m))
  const scrollToBottom = () => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
    followBottom.current = true; setAwayFromBottom(false)
  }
  useEffect(() => {
    if (followBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [view, loading])
  useEffect(() => {
    const element = taRef.current
    if (element) { element.style.height = '0px'; element.style.height = `${Math.min(element.scrollHeight, 180)}px` }
  }, [text, empty])

  const groups = useMemo(() => {
    const search = query.trim().toLowerCase()
    const list = [...sessions].filter(s => agentOf(s) === selectedAgentId && (!search || sessionTitle(s).toLowerCase().includes(search)))
      .sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
    return ['今天', '昨天', '更早'].map(label => ({ label, items: list.filter(s => dayBucket(s.updatedAt) === label) })).filter(group => group.items.length)
  }, [query, sessions, selectedAgentId])
  const title = sessions.find(s => s.id === sessionId)
  const mainAgent = peers.find(peer => peer.id === CORE_AGENT_ID) ?? null
  const currentAgent = selectedAgentId ? peers.find(peer => peer.id === selectedAgentId) : mainAgent
  const peersById = useMemo(() => new Map(peers.map(peer => [peer.id, peer])), [peers])
  const agentName = currentAgent?.name || (selectedAgentId ? 'Agent' : BRAND.name)
  const composerPlaceholder = dictation.listening ? '正在听你说…' : busy ? '继续提问或调整当前任务…' : `和 ${agentName} 一起工作`
  const agentAvatar = currentAgent?.avatar || (!selectedAgentId ? '/icon-64x64.png' : null)
  const avatarBadge = <span className="sl-chat__agent-avatar" aria-hidden="true">
    {agentAvatar ? <img src={agentAvatar} alt="" /> : agentName.trim()[0]?.toUpperCase()}
  </span>
  const agentPreviews = useMemo(() => {
    const result: Record<string, AgentPreview> = {}
    const sorted = [...sessions].sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
    for (const session of sorted) {
      const key = agentOf(session) ?? 'main'
      const current = result[key]
      const snapshot = getLive(session.id)
      const local = session.id === sessionId ? view.findLast(message => message.kind !== AGENT_MESSAGE_SENT)?.content : snapshot?.content
      const running = session.generating || snapshot?.running === true
      if (!current) result[key] = { text: previewSnippet(local) || previewSnippet(previews[session.id]) || previewSnippet(session.title), unread: Boolean(session.unread), running }
      else { current.unread ||= Boolean(session.unread); current.running ||= running }
    }
    return result
  }, [sessions, previews, sessionId, view])
  const copy = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(index); window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800)
    } catch { setToast('复制失败，请手动选择文字复制') }
  }
  const openReader = useCallback((message: ViewMsg, index: number, trigger: HTMLElement) => {
    if (!message.content) return
    readerTriggerRef.current = trigger
    /* 压一格同地址历史：手机返回手势先回到这格之前的对话页，由 popstate 收起全屏层，
       而不是被浏览器当成「退出页面」。同地址保证路由不跳转、hashchange 不触发。 */
    if (!readerHistoryActive.current) {
      try {
        const previous = window.history.state
        const base = previous && typeof previous === 'object' ? previous : {}
        window.history.pushState({ ...base, [READER_HISTORY_KEY]: true }, '')
        readerHistoryActive.current = true
      } catch {
        /* 极端环境下 History API 不可用：层照常打开，只是返回手势会按浏览器默认行为离开页面 */
        readerHistoryActive.current = false
      }
    }
    setReader({ message, index })
  }, [])

  return (
    <div className={`slime-surface sl-chat${sidebarOpen ? ' is-sidebar-open' : ''}${empty ? ' is-welcome' : ''}`}>
      {narrow && sidebarOpen && <button type="button" className="sl-chat__scrim" tabIndex={-1} aria-label="关闭会话列表" onClick={closeSidebar} />}
      <aside className="sl-chat__side" id="slime-history" ref={sideRef} inert={!sidebarOpen || reader !== null} aria-label="Agent 导航" role={narrow && sidebarOpen ? 'dialog' : undefined} aria-modal={narrow && sidebarOpen ? true : undefined}>
        <AgentSidebar mainAgent={mainAgent} agents={peers.filter(peer => peer.id !== CORE_AGENT_ID)}
          selectedAgentId={selectedAgentId} previews={agentPreviews} loading={peersLoading} error={peersError}
          disabled={creating} narrow={narrow} userSlot={userSlot} onSelectAgent={selectAgent}
          onReload={reloadPeers} onClose={closeSidebar} />
      </aside>

      <main ref={mainRef} className="sl-chat__main" aria-label="对话" tabIndex={-1} inert={reader !== null || (narrow && sidebarOpen)}>
        <header className="sl-chat__header" data-tauri-drag-region>
          {narrow && <button ref={menuRef} type="button" className={`sl-chat__icon sl-chat__menubtn${sidebarOpen ? ' is-hidden' : ''}`} title="展开 Agent 列表" aria-label="展开 Agent 列表" aria-expanded={sidebarOpen} aria-controls="slime-history" onClick={() => { setHistoryOpen(false); setDrawerOpen(true) }}><PanelLeftOpen size={19} /></button>}
          <div className="sl-chat__heading sl-chat__agent-heading">
            {avatarBadge}
            <span className="sl-chat__agent-title"><strong>{agentName}</strong><small>{busy ? '处理中…' : title ? sessionTitle(title) : '新对话'}</small></span>
            {busy && <span className="sl-chat__running" aria-hidden="true" />}
          </div>
          <div className="sl-chat__headtools">
            <SlimeAppearanceButton />
            <button ref={historyButtonRef} type="button" className="sl-chat__icon" title="历史对话" aria-label="历史对话" aria-expanded={historyOpen} aria-controls="slime-agent-history" onClick={() => { setHistoryOpen(!historyOpen); setQuery('') }}><History size={18} /></button>
            <button type="button" className="sl-chat__icon" title="新对话" aria-label="新对话" disabled={creating} onClick={newChat}><PenLine size={18} /></button>
          </div>
        </header>
        {historyOpen && <div ref={historyRef} className="sl-chat__historypanel" id="slime-agent-history" role="dialog" aria-label={`${agentName} 的历史对话`}>
          <div className="sl-chat__historypanel-head"><span>与 {agentName} 的对话</span><button type="button" className="sl-chat__icon" aria-label="关闭历史对话" onClick={() => { setHistoryOpen(false); historyButtonRef.current?.focus() }}><X size={16} /></button></div>
          <label className="sl-chat__historypanel-search"><Search size={15} /><input autoFocus aria-label="搜索历史对话" placeholder="搜索对话…" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <button type="button" className="sl-chat__historypanel-new" onClick={newChat} disabled={creating}><Plus size={16} />新对话</button>
          <div className="sl-chat__historypanel-list scrollbar-slim">
            {sessionsError ? <div className="sl-chat__nohistory">暂时无法加载历史<button type="button" onClick={reloadSessions}>重新加载</button></div>
              : !groups.length && <p className="sl-chat__nohistory">{query ? '没有找到相关对话' : '还没有历史对话，开始聊聊吧。'}</p>}
            {groups.map(group => <div className="sl-chat__group" key={group.label}><p>{group.label}</p>{group.items.map(session => <button type="button" key={session.id} disabled={creating} aria-current={session.id === sessionId ? 'page' : undefined} className={`sl-chat__session${session.id === sessionId ? ' is-active' : ''}`} onClick={() => openSession(session.id)}><MessageSquare size={15} /><span>{sessionTitle(session)}</span>{(session.generating || session.unread) && <i aria-label={session.generating ? '正在回复' : '未读消息'} />}</button>)}</div>)}
          </div>
        </div>}
        {connErr && <div className="sl-chat__banner" role="status">暂时连接不上服务，请检查后端是否已启动。</div>}
        <div className="sl-chat__scroll scrollbar-slim" ref={scrollRef} onScroll={() => {
          const element = scrollRef.current
          if (!element) return
          const away = element.scrollHeight - element.scrollTop - element.clientHeight > 100
          followBottom.current = !away; setAwayFromBottom(away)
        }} aria-busy={loading}>
          {loading ? <div className="sl-chat__loading" role="status"><span className="sl-chat__thinking"><i /><i /><i /></span>正在打开对话</div>
            : messageError ? <div className="sl-chat__loading" role="status">暂时无法打开这段对话。<button type="button" onClick={() => sessionId && openSession(sessionId)}>重新加载</button></div>
            : empty ? <div className="sl-chat__welcome">
              <h1>{slogan.replaceAll('{agent}', agentName)}</h1>
            </div>
            : <div className="sl-chat__thread" role="log" aria-label="对话消息">
              {view.map((message, index) => {
                if (message.kind === AGENT_MESSAGE_SENT) {
                  return sessionId ? <AgentMessageReceipt key={message.id} sessionId={sessionId} content={message.content} peers={peersById} /> : null
                }
                const turn = questionTurn(message)
                /* 手机端：点气泡直接进全屏阅读。流式中的回复先不开放，避免点开时内容还在长；
                   气泡里的链接 / 按钮 / 输入控件和文本选择由 canExpandBubble 让行。 */
                const expandable = narrow && Boolean(message.content) && !message.streaming
                const expand = expandable
                  ? (event: ReactMouseEvent<HTMLElement>) => {
                      if (canExpandBubble(event)) openReader(message, index, event.currentTarget)
                    }
                  : undefined
                return <article key={message.id ?? `live-${index}`} className={`sl-chat__turn sl-chat__turn--${message.role}`} aria-label={message.role === 'user' ? '你的消息' : `${agentName} 的回复`}>
                  {message.role === 'user' ? <div className={`sl-chat__bubble${expandable ? ' is-expandable' : ''}`} onClick={expand} title={expandable ? '点按全屏查看' : undefined} tabIndex={expandable ? -1 : undefined}>{message.content}</div> : <>
                    <div className={`sl-chat__answer${expandable ? ' is-expandable' : ''}`} onClick={expand} title={expandable ? '点按全屏查看' : undefined} tabIndex={expandable ? -1 : undefined}>
                      {turn ? <>{turn.before && <ChatMarkdown content={turn.before} />}<UserQuestionCard key={JSON.stringify(turn.question)} question={turn.question} active={!busy && !creating && !loading && !live?.error && index === latestTurn} onAnswer={sendText} />{turn.after && <ChatMarkdown content={turn.after} />}</>
                        : message.streaming ? message.content ? <div className="sl-chat__stream">{message.content}</div> : <span className="sl-chat__thinking" aria-hidden="true"><i /><i /><i /></span>
                        : <ChatMarkdown content={message.content} />}
                    </div>
                    {message.content && !message.streaming && <div className="sl-chat__message-actions"><button type="button" className="sl-chat__icon" aria-label={copied === index ? '已复制回复' : '复制回复'} title={copied === index ? '已复制' : '复制回复'} onClick={() => void copy(message.content, index)}>{copied === index ? <Check size={14} /> : <Copy size={14} />}</button></div>}
                  </>}
                </article>
              })}
            </div>}
        </div>
        {awayFromBottom && !empty && <button type="button" className="sl-chat__jump" aria-label="回到最新消息" onClick={scrollToBottom}><ArrowDown size={16} /><span>最新消息</span></button>}
        <div className="sl-chat__composearea">
          <ComposerActivity key={sessionId} agentName={agentName} avatar={avatarBadge} live={live} />
          <form className={`sl-chat__composer${busy ? ' is-busy' : ''}`} onSubmit={event => { event.preventDefault(); void sendText(text) }}>
            <textarea ref={taRef} rows={1} value={text} onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && !narrow) {
                  event.preventDefault(); void sendText(text)
                }
              }} placeholder={composerPlaceholder} aria-label={`给 ${agentName} 发消息`} disabled={loading || messageError} />
            <div className="sl-chat__composerbar">
              <div className="sl-chat__compose-left">
                <details ref={moreRef} className="sl-chat__compose-more">
                  <summary aria-label="更多操作" title="更多操作"><Plus size={18} /></summary>
                  <div className="sl-chat__compose-menu">
                    <button type="button" disabled={creating} onClick={() => { if (moreRef.current) moreRef.current.open = false; newChat() }}><PenLine size={15} />新对话</button>
                    <a href="#/import"><BookOpen size={15} />导入资料</a>
                    <a href="#/snapshots"><Plus size={15} />保存网页</a>
                  </div>
                </details>
                <a className="sl-chat__permissions" href={`#/multi-agent/${encodeURIComponent(selectedAgentId ?? CORE_AGENT_ID)}`} title="配置当前 Agent 的工具权限"><ShieldCheck size={15} /><span>工具权限</span></a>
              </div>
              <div className={`sl-chat__compose-right${dictation.supported ? '' : ' without-dictation'}`}>
              <ComposerModelPicker models={settings?.models.map(model => ({ id: model.id, name: model.name, model: model.model, efforts: model.reasoningEfforts })) ?? []}
                value={modelId} inheritedModelId={inheritedModelId} inheritedLabel={settings?.models.find(model => model.id === inheritedModelId)?.model || '跟随 Agent'}
                effort={supportedEffort} onModelChange={value => { setModelId(value); setReasoningEffort(undefined) }} onEffortChange={setReasoningEffort}
                disabled={busy || creating || loading} loading={settingsLoading} error={settingsError} onRetry={reloadSettings} />
              {dictation.supported && <button type="button" className={`sl-chat__dictate${dictation.listening ? ' is-listening' : ''}`} title={dictation.listening ? '结束听写' : '语音输入'} aria-label={dictation.listening ? '结束听写' : '语音输入'} aria-pressed={dictation.listening} disabled={creating || loading || messageError} onClick={toggleDictation}><AppIcon name="microphone" /></button>}
              {busy && <button
                type="button"
                className="sl-chat__send is-stop"
                title={live?.stopping ? '正在停止回复' : '停止回复'}
                aria-label={live?.stopping ? '正在停止回复' : '停止回复'}
                disabled={live?.stopping || live?.userMessageId == null}
                onClick={() => sessionId && stopChat(sessionId)}
              ><AppIcon name="stop" size={14} /></button>}
              {!busy && !text.trim() && dictation.supported
                ? <button type="button" className={`sl-chat__send${dictation.listening ? ' is-stop' : ''}`} title={dictation.listening ? '结束听写' : '语音输入'} aria-label={dictation.listening ? '结束听写' : '语音输入'} disabled={creating || loading || messageError} onClick={toggleDictation}><AppIcon name={dictation.listening ? 'stop' : 'dictation'} size={dictation.listening ? 12 : 16} /></button>
                : <button
                  type="submit"
                  className="sl-chat__send"
                  title={busy ? '发送到当前任务' : '发送消息'}
                  aria-label="发送消息"
                  disabled={!text.trim() || creating || loading || messageError || (busy && (live?.stopping || live?.userMessageId == null))}
                ><AppIcon name="arrow-up" /></button>}
              </div>
            </div>
          </form>
          {empty && <div className="sl-chat__suggestions">{SUGGESTIONS.map(({ label, text: suggestion, icon: Icon }) => <button type="button" key={label} disabled={!!text.trim()} onClick={() => { setText(current => current.trim() ? current : suggestion); taRef.current?.focus() }}><Icon size={15} />{label}</button>)}</div>}
        </div>
        {toast && <div className="sl-chat__toast" role="status">{toast}<button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}
      </main>

      {/* 手机端气泡的全屏阅读层：铺满视口、独立滚动，关闭后焦点回到被点开的那只气泡。
          挂到 body 上，避免被会话页的 overflow 与层叠上下文裁掉。 */}
      {reader && createPortal(
        <section
          ref={readerRef}
          className="slime-surface sl-chat__reader"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sl-chat-reader-title"
        >
          <header className="sl-chat__reader-head">
            <button
              ref={readerCloseRef}
              type="button"
              className="sl-chat__icon"
              aria-label="收起全屏视图"
              title="收起全屏视图"
              onClick={closeReader}
            >
              <ChevronDown size={20} />
            </button>
            <span id="sl-chat-reader-title" className="sl-chat__reader-title">
              {reader.message.role === 'user' ? '你的消息' : `${agentName} 的回复`}
            </span>
            <button
              type="button"
              className="sl-chat__icon"
              aria-label={copied === reader.index ? '已复制全文' : '复制全文'}
              title={copied === reader.index ? '已复制' : '复制全文'}
              onClick={() => void copy(reader.message.content, reader.index)}
            >
              {copied === reader.index ? <Check size={17} /> : <Copy size={17} />}
            </button>
          </header>
          <div className="sl-chat__reader-scroll scrollbar-slim">
            <div className={`sl-chat__reader-body${reader.message.role === 'user' ? ' is-user' : ''}`}>
              {reader.message.role === 'user'
                ? <p className="sl-chat__reader-text">{reader.message.content}</p>
                : <div className="sl-chat__reader-markdown"><ChatMarkdown content={reader.message.content} /></div>}
            </div>
          </div>
        </section>,
        document.body,
      )}
    </div>
  )
}
