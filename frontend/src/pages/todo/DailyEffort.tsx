import type { TodoOverview } from '../../api/todo'
import { AppIcon } from '../../components/AppIcon'
import { Button } from '../../components/ui'
import { clockTime, duration, focusMillis, timer } from './format'
import { useServerClock } from './useServerClock'

export default function DailyEffort({ overview, receivedAt, project, busy, canBackfill, onDetail, onPause, onBackfill, onTimeline }: {
  overview: TodoOverview; receivedAt: number; project: string; busy: boolean; canBackfill: boolean
  onDetail: (id: string) => void; onPause: () => void; onBackfill: () => void; onTimeline: () => void
}) {
  const active = overview.active
  const now = useServerClock(overview.now, receivedAt, active ? 1000 : 0)
  const daily = overview.todayFocus
  const dailyTotal = daily.reduce((sum, focus) => sum + focusMillis(focus, now, overview.dayStart, overview.dayEnd), 0)
  const allocation = new Map<string, { title: string; millis: number }>()
  for (const focus of daily) {
    const millis = (allocation.get(focus.todoId)?.millis ?? 0) + focusMillis(focus, now, overview.dayStart, overview.dayEnd)
    allocation.set(focus.todoId, { title: focus.title, millis })
  }
  const activeOutsideFilter = active && project && active.projectId !== (project === 'unassigned' ? null : project)

  return (
    <>
      <section className="todo-current-focus" data-running={!!active || undefined}>
        <h2><AppIcon name="clock" />专注计时</h2>
        {active ? <>
          <div className="todo-timer" aria-label="当前专注时长">{timer(now - active.startedAt)}</div>
          <button type="button" className="todo-focus-title" onClick={() => onDetail(active.todoId)}>{active.title}</button>
          {active.projectName && <p className="todo-secondary">{active.projectName}</p>}
          {activeOutsideFilter && <p className="todo-secondary">当前计时属于其他项目。</p>}
          {now - active.startedAt > 8 * 3600000 && <p className="todo-long-running">本次计时已超过 8 小时。暂停后可修正时段。</p>}
          <Button size="sm" disabled={busy} onClick={onPause}><AppIcon name="pause" />暂停计时</Button>
        </> : <p className="todo-secondary">从待办列表开始计时。</p>}
      </section>
      <section className="todo-daily-effort">
        <header className="todo-section-heading"><h2>今日投入</h2><Button size="sm" variant="quiet" disabled={busy || !canBackfill} onClick={onBackfill}><AppIcon name="plus" size={14} />补记</Button></header>
        <p className="todo-daily-total">{duration(dailyTotal)}</p>
        {project && <p className="todo-secondary">当前项目筛选</p>}
        {allocation.size > 0 && <div className="todo-daily-allocations">{[...allocation].map(([id, value]) => (
          <div key={id} className="todo-allocation">
            <div><button type="button" onClick={() => onDetail(id)}>{value.title}</button><span>{duration(value.millis)}</span></div>
            <div className="todo-allocation-track"><span style={{ width: `${dailyTotal ? value.millis / dailyTotal * 100 : 0}%` }} /></div>
          </div>
        ))}</div>}
        {daily.length > 0 && <details className="todo-focus-details">
          <summary>专注记录 <span>{daily.length}</span></summary>
          <ol className="todo-focus-log">{daily.map(focus => <li key={focus.id}>
            <small>{clockTime(Math.max(focus.startedAt, overview.dayStart))} – {focus.endedAt === null ? '计时中' : clockTime(Math.min(focus.endedAt, overview.dayEnd))}{focus.startedAt < overview.dayStart ? ' · 跨天续接' : ''}</small>
            <button type="button" onClick={() => onDetail(focus.todoId)}>{focus.title}</button>
            <p>{focus.note || duration(focusMillis(focus, now, overview.dayStart, overview.dayEnd))}</p>
          </li>)}</ol>
        </details>}
        <Button size="sm" variant="quiet" className="todo-timeline-link" onClick={onTimeline}>查看全天时间表<AppIcon name="arrow-right" /></Button>
      </section>
    </>
  )
}
