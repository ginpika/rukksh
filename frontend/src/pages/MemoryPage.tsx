import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
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
import { AppIcon } from '../components/AppIcon'
import type { GalaxyCluster } from './memory/MemoryGalaxy'
import MemoryInspector from './memory/MemoryInspector'
import { errorText, expiring, status, time } from './memory/model'
import './memory/memory.css'
import './memory/memoryGalaxy.css'

const MemoryGalaxy = lazy(() => import('./memory/MemoryGalaxy'))

const MAX_PER_CLUSTER = 40
const PAGE_SIZE = 20
const DAY = 86_400_000
const dateLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })

type MemoryData = { items: MemoryItem[]; peers: MaPeer[]; fetchedAt: number }
type DetailData = { shares?: MemoryShare[]; projects?: Project[]; sessions?: SessionItem[] }

/* oxlint-disable react/set-state-in-effect */
export default function MemoryPage() {
  const [data, setData] = useState<MemoryData | null>(null)
  const [details, setDetails] = useState<DetailData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [search, setSearch] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const selected = data?.items.find(item => item.id === selectedId)
  const hasSelection = selected != null

  useEffect(() => {
    const reset = () => {
      setData(null)
      setDetails({})
      setSelectedId(null)
      setFocus(null)
      setAttentionOnly(false)
      setSearch('')
      setPage(1)
      setTick(value => value + 1)
    }
    window.addEventListener('rukksh:memory-reset', reset)
    return () => window.removeEventListener('rukksh:memory-reset', reset)
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    Promise.all([memoryItems(), listMaPeers()])
      .then(([items, peers]) => {
        if (live) setData({ items, peers, fetchedAt: Date.now() })
      })
      .catch((e: unknown) => {
        if (live) setError(errorText(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => { live = false }
  }, [tick])

  useEffect(() => {
    if (!hasSelection) return
    let live = true
    Promise.allSettled([memoryShared(), listProjects(), listSessions()]).then(([shares, projects, sessions]) => {
      if (live) setDetails({
        shares: shares.status === 'fulfilled' ? shares.value : undefined,
        projects: projects.status === 'fulfilled' ? projects.value : undefined,
        sessions: sessions.status === 'fulfilled' ? sessions.value : undefined,
      })
    })
    return () => { live = false }
  }, [hasSelection, tick])

  const { clusters, agentNames, active, dueIds, recent } = useMemo(() => {
    const agentNames = new Map(data?.peers.map(peer => [peer.id, peer.name]))
    if (!agentNames.has('builtin')) agentNames.set('builtin', '内置 Agent')
    const grouped = new Map<string, MemoryItem[]>(data?.peers.map(peer => [peer.id, []]))
    const dueIds = new Set<number>()
    const active: MemoryItem[] = []
    let recent = 0
    if (data) {
      const now = data.fetchedAt
      for (const item of data.items) {
        if (!item.agentId || status(item, now) !== '有效') continue
        const id = item.agentId
        if (!agentNames.has(id)) agentNames.set(id, `未登记 Agent · ${id}`)
        const group = grouped.get(id)
        if (group) group.push(item)
        else grouped.set(id, [item])
        active.push(item)
        if (expiring(item, now)) dueIds.add(item.id)
        if (item.createdAt >= now - 7 * DAY) recent++
      }
    }
    const newestFirst = (a: MemoryItem, b: MemoryItem) => b.createdAt - a.createdAt || b.id - a.id
    active.sort(newestFirst)
    const avatars = new Map(data?.peers.map(peer => [peer.id, peer.avatar]))
    const clusters: GalaxyCluster[] = Array.from(grouped, ([id, items], order) => ({
      id,
      name: agentNames.get(id) ?? id,
      avatar: avatars.get(id),
      order,
      items: items.sort(newestFirst).slice(0, MAX_PER_CLUSTER),
    }))
    return { clusters, agentNames, active, dueIds, recent }
  }, [data])

  const focusedCluster = clusters.find(cluster => cluster.id === focus)
  const focusId = focusedCluster?.id ?? null
  const query = search.trim().toLowerCase()
  const scoped = useMemo(() => active.filter(item => (
    (!focusId || item.agentId === focusId)
    && (!query || `${item.title ?? ''} ${item.body} ${agentNames.get(item.agentId ?? '') ?? ''}`.toLowerCase().includes(query))
  )), [active, focusId, query, agentNames])
  const due = useMemo(() => scoped.filter(item => dueIds.has(item.id)), [scoped, dueIds])
  const results = attentionOnly ? due : scoped
  const filtersOn = Boolean(focusId || query || attentionOnly)
  const matchingIds = useMemo(() => filtersOn ? new Set(results.map(item => item.id)) : null, [filtersOn, results])
  const plotted = useMemo(() => clusters.reduce((total, cluster) => (
    total + (matchingIds ? cluster.items.filter(item => matchingIds.has(item.id)).length : cluster.items.length)
  ), 0), [clusters, matchingIds])
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const visible = results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function goToPage(value: number) {
    setPage(value)
    list.current?.scrollTo(0, 0)
  }

  function changeFocus(id: string | null) {
    setFocus(id)
    goToPage(1)
  }

  function clearFilters() {
    setSearch('')
    setAttentionOnly(false)
    changeFocus(null)
    searchField.current?.focus()
  }

  const refresh = () => setTick(value => value + 1)

  return (
    <div className="mem-galaxy-page">
      <header className="mem-galaxy-header">
        <div className="mem-galaxy-heading">
          <h2>记忆星云</h2>
          <dl className="mem-galaxy-stats">
            <div><dt>Agent 星系</dt><dd>{data ? clusters.length.toLocaleString() : '—'}</dd></div>
            <div><dt>有效记忆</dt><dd>{data ? active.length.toLocaleString() : '—'}</dd></div>
            <div><dt>近 7 天新增</dt><dd>{data ? recent.toLocaleString() : '—'}</dd></div>
          </dl>
        </div>
        <a className="mem-galaxy-ops" href="#/memory/ops">
          <AppIcon name="sliders" size={15} />运行时观察<AppIcon name="arrow-right" size={14} />
        </a>
      </header>

      {error && (
        <div className="mem-galaxy-error" role="alert">
          <AppIcon name="alert" />
          <div><strong>{data ? '更新失败，正在显示上次读取的数据' : '记忆读取失败'}</strong><p>{error}</p></div>
          <button type="button" onClick={refresh}>重试</button>
        </div>
      )}

      <div className="mem-galaxy-layout">
        <section className="mem-galaxy-map" aria-label="星云图">
          <div className="mem-galaxy-map-heading">
            <span className="mem-galaxy-map-mark"><AppIcon name="center" size={19} /></span>
            <div>
              <strong title={focusedCluster?.name}>{focusedCluster?.name ?? '全部星系'}</strong>
              <span>{data ? `图中 ${plotted.toLocaleString()} 条${plotted < results.length ? ` / ${results.length.toLocaleString()} 条` : ''}` : loading ? '读取中' : '数据不可用'}</span>
            </div>
          </div>
          <Suspense fallback={<div className="mem-galaxy-stage mem-galaxy-stage-message" role="status">正在加载星云图…</div>}>
            <MemoryGalaxy
              clusters={clusters}
              matchingIds={matchingIds}
              dueIds={dueIds}
              focus={focusId}
              onFocus={changeFocus}
              onOpen={item => setSelectedId(item.id)}
            />
          </Suspense>
          <ul className="mem-galaxy-legend" aria-label="图例">
            <li><i className="mem-legend-agent" />Agent</li>
            <li><i className="mem-legend-memory" />记忆</li>
            <li><i className="mem-legend-due" />即将到期</li>
          </ul>
        </section>

        <section className="mem-galaxy-index" aria-labelledby="memory-index-heading" aria-busy={loading}>
          <header className="mem-galaxy-index-header">
            <div className="mem-galaxy-index-title">
              <h3 id="memory-index-heading">记忆条目</h3>
              {data && <span className="sr-only" role="status">{results.length.toLocaleString()} 条</span>}
            </div>
            <div className="mem-galaxy-search">
              <AppIcon name="search" />
              <input
                ref={searchField}
                type="search"
                value={search}
                placeholder="搜索标题、正文或 Agent"
                aria-label="搜索记忆"
                onChange={event => { setSearch(event.target.value); goToPage(1) }}
              />
              {search && <button type="button" aria-label="清除搜索" onClick={() => { setSearch(''); goToPage(1); searchField.current?.focus() }}><AppIcon name="close" size={15} /></button>}
            </div>
            <div className="mem-galaxy-scope">
              <AppIcon name="agent" />
              <select aria-label="筛选 Agent" value={focusId ?? ''} onChange={event => changeFocus(event.target.value || null)}>
                <option value="">全部 Agent</option>
                {clusters.map(cluster => <option key={cluster.id} value={cluster.id}>{cluster.name}</option>)}
              </select>
              <AppIcon name="chevron-down" size={15} />
            </div>
            <div className="mem-galaxy-filters" role="group" aria-label="到期筛选">
              <button type="button" aria-pressed={!attentionOnly} onClick={() => { setAttentionOnly(false); goToPage(1) }}>全部{data && <span>{scoped.length}</span>}</button>
              <button type="button" aria-pressed={attentionOnly} onClick={() => { setAttentionOnly(true); goToPage(1) }}>7 天内到期{data && <span>{due.length}</span>}</button>
            </div>
          </header>

          <div ref={list} className="mem-galaxy-index-body scrollbar-slim">
            {visible.length > 0 ? (
              <ul className="mem-galaxy-index-list">
                {visible.map(item => (
                  <li key={item.id}>
                    <button type="button" className="mem-galaxy-result" onClick={() => setSelectedId(item.id)}>
                      <span className="mem-galaxy-row-content">
                        <strong>{item.title || item.body || '未命名记忆'}</strong>
                        {item.title && item.body && <span className="mem-galaxy-excerpt">{item.body}</span>}
                        <span className="mem-galaxy-row-meta">
                          <span className="mem-galaxy-owner">{agentNames.get(item.agentId ?? '')}</span>
                          <time dateTime={new Date(item.createdAt).toISOString()} title={time(item.createdAt)}>{dateLabel.format(item.createdAt)}</time>
                          {item.pinned && <span>已固定</span>}
                          {dueIds.has(item.id) && <span className="mem-galaxy-due">即将到期</span>}
                        </span>
                      </span>
                      <AppIcon name="chevron-right" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mem-galaxy-index-empty" role="status">
                <AppIcon name={loading ? 'loading' : error && !data ? 'alert' : filtersOn ? 'search' : 'file'} size={23} />
                <strong>{loading ? '正在读取记忆…' : error && !data ? '记忆暂不可用' : filtersOn ? '没有匹配的记忆' : '暂无有效记忆'}</strong>
                {!loading && data && (filtersOn
                  ? <button type="button" onClick={clearFilters}>清除筛选</button>
                  : <a href="#/memory/ops">管理记忆<AppIcon name="arrow-right" size={14} /></a>)}
              </div>
            )}
          </div>

          {pages > 1 && (
            <nav className="mem-galaxy-pagination" aria-label="记忆分页">
              <span>第 {currentPage} / {pages} 页</span>
              <button type="button" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} aria-label="上一页"><AppIcon name="chevron-left" /></button>
              <button type="button" disabled={currentPage === pages} onClick={() => goToPage(currentPage + 1)} aria-label="下一页"><AppIcon name="chevron-right" /></button>
            </nav>
          )}
        </section>
      </div>

      {selected && createPortal(
        <div
          className="mem-observatory rukksh-surface mem-detail-overlay mem-galaxy-detail"
          onClick={event => {
            if (event.target === event.currentTarget) setSelectedId(null)
          }}
        >
          <MemoryInspector
            key={selected.id}
            item={selected}
            shares={details.shares ?? []}
            sharesAvailable={details.shares != null}
            showDiagnostics={false}
            agentNames={agentNames}
            projectNames={new Map(details.projects?.map(project => [project.id, project.name]))}
            sessionNames={new Map(details.sessions?.map(session => [session.id, session.title || session.id]))}
            changed={refresh}
            close={() => setSelectedId(null)}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}
