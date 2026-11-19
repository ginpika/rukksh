import { useCallback, useEffect, useRef, useState } from 'react'
import { codingError, codingProjects, codingRuns, type CodingProject, type CodingRun } from '../../api/coding'
import { AppIcon } from '../../components/AppIcon'
import CodingRoleSettings from './CodingRoleSettings'

const statuses: Record<string, string> = { QUEUED: '等待开始', PREPARING: '准备项目', RUNNING: '执行中', VERIFYING: '验证中', REVIEWABLE: '等待审阅', PAUSED: '已暂停', INTERRUPTED: '已中断', FAILED: '失败', CANCELLED: '已停止', CANCELLING: '正在停止', ACCEPTING: '应用中', COMPLETED: '已应用' }
statuses.WAITING_AGENTS = '等待子 Agent'

/** Reads the same owner-scoped tasks as the coding studio, without starting another runtime. */
export default function AgentTasks() {
  const [runs, setRuns] = useState<CodingRun[]>([])
  const [projects, setProjects] = useState<CodingProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const load = useCallback(async (showLoading = true) => {
    if (pending.current) return
    pending.current = true
    if (showLoading) setLoading(true)
    setError('')
    const [tasks, items] = await Promise.allSettled([codingRuns(), codingProjects()])
    if (tasks.status === 'fulfilled') setRuns(tasks.value)
    if (items.status === 'fulfilled') setProjects(items.value)
    setError([tasks, items].flatMap(item => item.status === 'rejected' ? [codingError(item.reason)] : []).join('；'))
    setLoading(false)
    pending.current = false
  }, [])
  useEffect(() => { void load() }, [load])
  const active = runs.some(run => ['QUEUED', 'PREPARING', 'RUNNING', 'WAITING_AGENTS', 'VERIFYING', 'CANCELLING', 'ACCEPTING'].includes(run.status))
  useEffect(() => {
    if (!active || error) return
    const timer = window.setInterval(() => void load(false), 3000)
    return () => window.clearInterval(timer)
  }, [active, error, load])
  return <div className="ad-stack">
    <section className="ad-section">
      <div className="ad-section-head">
        <h3>我的编码任务</h3>
        <button type="button" className="ad-btn" disabled={loading} onClick={() => void load()}>
          <AppIcon name="refresh" size={14} />刷新任务
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {loading ? <p role="status" className="ad-empty">正在读取编码任务…</p> : !runs.length ? (
        <p className="ad-empty">暂无编码任务。可以在编程工作台开始，或在对话中交给默认 Agent 处理。</p>
      ) : <div className="flex flex-col gap-2">{runs.map(run => {
        const project = projects.find(item => item.id === run.repositoryId)
        return <a key={run.id} href={`#/coding?project=${encodeURIComponent(run.repositoryId)}&run=${encodeURIComponent(run.id)}`} className="ad-record flex min-w-0 items-start gap-3 px-3 py-3">
          <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{run.prompt}</strong><span className="mt-1 block text-xs text-muted">{project?.name || '仓库任务'} · {run.mode} · #{run.taskId}</span></span><span className="shrink-0 text-xs text-muted">{statuses[run.status] || run.status} ↗</span>
        </a>
      })}</div>}
      <p className="ad-hint">编程任务使用默认 Agent 的身份和模型。编程规程可在「提示词 → Skills · 状态化提示词」中编辑。</p>
    </section>
    <CodingRoleSettings />
  </div>
}
