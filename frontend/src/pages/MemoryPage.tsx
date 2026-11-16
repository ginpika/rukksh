import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  listMaPeers,
  listProjects,
  listSessions,
  memoryItems,
  memoryShared,
  type MaPeer,
  type MemoryItem,
  type MemoryShare,
  type Project,
  type SessionItem,
} from '../api/client'
import { memorySnapshots, type SnapshotSummary } from '../api/memoryObservation'
import type { GalaxyCluster } from './memory/MemoryGalaxy'
import MemoryInspector from './memory/MemoryInspector'
import { errorText, expiring, status, time } from './memory/model'
import './memory/memory.css'

/* Three.js 星云单独成 chunk，避免拖慢其他页面首屏。 */
const MemoryGalaxy = lazy(() => import('./memory/MemoryGalaxy'))

const MAX_PER_CLUSTER = 40
/* 读取开始重置加载状态；快速重试时旧请求结果不会覆盖新结果。 */
/* oxlint-disable react/set-state-in-effect */

export default function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [peers, setPeers] = useState<MaPeer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selected, setSelected] = useState<MemoryItem | null>(null)

  const [shares, setShares] = useState<MemoryShare[]>([])
  const [sharesOk, setSharesOk] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [extrasLoaded, setExtrasLoaded] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    Promise.all([memoryItems(), listMaPeers()])
      .then(([nextItems, nextPeers]) => {
        if (!live) return
        setItems(nextItems)
        setPeers(nextPeers)
      })
      .catch((e: unknown) => {
        if (live) setError(errorText(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [tick])

  /* 详情抽屉需要授权、项目、会话和快照；只在第一次打开时补读，首页保持轻量。 */
  useEffect(() => {
    if (!selected || extrasLoaded) return
    let live = true
    Promise.allSettled([memoryShared(), listProjects(), listSessions(), memorySnapshots()]).then(result => {
      if (!live) return
      if (result[0].status === 'fulfilled') {
        setShares(result[0].value)
        setSharesOk(true)
      }
      if (result[1].status === 'fulfilled') setProjects(result[1].value)
      if (result[2].status === 'fulfilled') setSessions(result[2].value)
      if (result[3].status === 'fulfilled') setSnapshots(result[3].value)
      setExtrasLoaded(true)
    })
    return () => {
      live = false
    }
  }, [selected, extrasLoaded])

  const agentNames = useMemo(() => {
    const map = new Map(peers.map(peer => [peer.id, peer.name] as const))
    if (!map.has('builtin')) map.set('builtin', '内置 Agent')
    for (const item of items) {
      const id = item.agentId
      if (id && !map.has(id)) map.set(id, `未登记 Agent · ${id}`)
    }
    return map
  }, [peers, items])

  const peerById = useMemo(() => new Map(peers.map(peer => [peer.id, peer] as const)), [peers])
  const peerOrder = useMemo(() => new Map(peers.map((peer, index) => [peer.id, index] as const)), [peers])

  /* 共享记忆暂不进入星云、搜索和计数；后续单独设计。 */
  const active = useMemo(() => items.filter(item => status(item) === '有效' && item.agentId != null), [items])

  const clusters = useMemo<GalaxyCluster[]>(() => {
    const grouped = new Map<string, MemoryItem[]>()
    for (const item of active) {
      const id = item.agentId ?? 'shared'
      const list = grouped.get(id)
      if (list) list.push(item)
      else grouped.set(id, [item])
    }
    const result: GalaxyCluster[] = []
    for (const [id, list] of grouped) {
      const isAgent = id !== 'shared'
      result.push({
        id,
        name: isAgent ? agentNames.get(id) ?? id : '共享记忆',
        avatar: isAgent ? peerById.get(id)?.avatar ?? null : null,
        isAgent,
        order: isAgent ? peerOrder.get(id) ?? peers.length + result.length : Number.MAX_SAFE_INTEGER,
        items: [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PER_CLUSTER),
      })
    }
    /* 还没记住任何东西的 Agent 也保留一颗空核心。 */
    for (const peer of peers) {
      if (!grouped.has(peer.id)) {
        result.push({ id: peer.id, name: peer.name, avatar: peer.avatar, isAgent: true, order: peerOrder.get(peer.id) ?? peers.length, items: [] })
      }
    }
    /* 创建顺序决定谁进中心轨道；共享记忆不是 Agent，固定排在最后。 */
    return result.sort((a, b) => {
      if (a.isAgent !== b.isAgent) return a.isAgent ? -1 : 1
      return (a.order ?? 0) - (b.order ?? 0)
    })
  }, [active, agentNames, peers, peerById, peerOrder])

  const [now] = useState(() => Date.now())
  const weekAgo = now - 7 * 86_400_000
  const recent = active.filter(item => item.createdAt >= weekAgo).length
  const attention = useMemo(() => active.filter(item => expiring(item)), [active])
  const results = useMemo(() => {
    if (!query) return []
    const q = query.toLowerCase()
    return active
      .filter(item => `${item.title ?? ''} ${item.body} ${agentNames.get(item.agentId ?? '') ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8)
  }, [active, agentNames, query])

  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name] as const)), [projects])
  const sessionNames = useMemo(() => new Map(sessions.map(session => [session.id, session.title || session.id] as const)), [sessions])
  const focusName = focus ? clusters.find(cluster => cluster.id === focus)?.name ?? focus : ''

  return (
    <div className="mem-galaxy-page">
      <div className="mem-galaxy-top">
        <p className="mem-galaxy-counts">
          {loading
            ? '正在读取记忆…'
            : error
              ? '记忆读取失败'
              : `已记住 ${active.length} 条${recent ? ` · 本周 +${recent}` : ''} · ${clusters.length} 个星系`}
        </p>
        <a className="mem-galaxy-ops" href="#/memory/ops">
          运行时观察 →
        </a>
      </div>

      <div className="mem-galaxy-search">
        <input
          type="search"
          value={search}
          placeholder="搜索你记住的内容…"
          aria-label="搜索记忆"
          onChange={event => setSearch(event.target.value)}
        />
      </div>

      {error && (
        <div className="mem-error" role="alert">
          <p>{error}</p>
          <button type="button" className="mem-galaxy-retry" onClick={() => setTick(v => v + 1)}>
            重新读取
          </button>
        </div>
      )}

      {!loading && !error && attention.length > 0 && (
        <button type="button" className="mem-galaxy-alert" onClick={() => setAttentionOnly(v => !v)} aria-pressed={attentionOnly}>
          <strong>{attention.length} 条记忆将在 7 天内停止自动使用</strong>
          <span>{attentionOnly ? '显示全部' : '只看这些'} →</span>
        </button>
      )}

      {focus && (
        <button type="button" className="mem-galaxy-chip" onClick={() => setFocus(null)}>
          只看「{focusName}」 · 返回全部星系
        </button>
      )}

      {query && (
        <section className="mem-galaxy-results" aria-label="搜索结果">
          <div className="mem-galaxy-results-head">
            <strong>搜索「{query}」</strong>
            <span>{results.length ? `${results.length} 条` : '没有匹配'}</span>
          </div>
          {results.map(item => (
            <button type="button" key={item.id} className="mem-galaxy-result" onClick={() => setSelected(item)}>
              <strong>{item.title || item.body.slice(0, 40)}</strong>
              <span>
                {item.agentId ? agentNames.get(item.agentId) ?? item.agentId : '共享'} · 记住于 {time(item.createdAt)}
              </span>
            </button>
          ))}
        </section>
      )}

      <Suspense fallback={<div className="mem-galaxy-stage" aria-busy="true" />}>
        <MemoryGalaxy
          clusters={clusters}
          query={query}
          focus={focus}
          attentionOnly={attentionOnly}
          onFocus={setFocus}
          onOpen={setSelected}
        />
      </Suspense>

      <p className="mem-galaxy-hint">
        真实 3D 场景：黑洞会按深度遮挡背后的 Agent。中心轨道最多 5 位 Agent 同速公转，其余 Agent 像星星一样停在四周的 3D 坐标；记忆点绕各自 Agent 公转。悬停记忆点或按住时暂停运动，拖动可旋转视角，滚轮缩放。越亮越新，越靠中心越重要，点击记忆圆点查看悬浮摘要与完整详情，点击 Agent 头像只看这位 Agent。
      </p>

      {!loading && !error && active.length === 0 && (
        <div className="mem-galaxy-empty">
          <h3>还没有长期记忆</h3>
          <p>
            和 Agent 多聊几次，记忆会慢慢亮起来；也可以去
            <a href="#/memory/ops">运行时观察</a>
            手动添加。
          </p>
        </div>
      )}

      {selected &&
        createPortal(
          <div
            className="mem-observatory slime-surface mem-detail-overlay"
            onClick={event => {
              if (event.target === event.currentTarget) setSelected(null)
            }}
          >
            <MemoryInspector
              key={selected.id}
              item={selected}
              shares={shares}
              sharesAvailable={sharesOk}
              selectedCount={extrasLoaded ? snapshots.filter(snapshot => snapshot.itemIds.includes(selected.id)).length : null}
              agentNames={agentNames}
              projectNames={projectNames}
              sessionNames={sessionNames}
              changed={() => setTick(v => v + 1)}
              close={() => setSelected(null)}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
