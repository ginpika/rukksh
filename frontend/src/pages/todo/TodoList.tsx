import type { TodoItem } from '../../api/todo'
import { AppIcon } from '../../components/AppIcon'
import { Button } from '../../components/ui'
import { duration } from './format'

export function TodoList({ title, items, empty, overdue, activeTodo, today, busy, onDetail, onComplete, onStart, onPause, onPlan, onClearPlan }: {
  title: string; items: TodoItem[]; empty: string; overdue: boolean; activeTodo: string | null; today: string; busy: boolean
  onDetail: (id: string) => void; onComplete: (todo: TodoItem) => void; onStart: (todo: TodoItem) => void
  onPause: () => void; onPlan: (todo: TodoItem) => void; onClearPlan: (todo: TodoItem) => void
}) {
  return (
    <section className={`todo-list-section${overdue ? ' todo-list-section--overdue' : ''}`}>
      <header className="todo-section-heading"><h2>{overdue && <AppIcon name="alert" />}{title}<span>{items.length}</span></h2></header>
      {items.length ? <ul className="todo-items" role="list">{items.map(item => {
        const done = item.state === 'done'
        const running = activeTodo === item.id
        const later = !done && item.plannedOn !== today
        return (
          <li className={`todo-item${done ? ' todo-item--done' : ''}`} data-running={running || undefined} key={item.id}>
            <button className="todo-check" type="button" aria-label={`${done ? '重新打开' : '完成'}：${item.title}`} aria-pressed={done}
              disabled={busy} onClick={() => onComplete(item)}><span>{done && <AppIcon name="check" size={12} />}</span></button>
            <div className="todo-item-body">
              <button type="button" className="todo-item-title" onClick={() => onDetail(item.id)}>{item.title}</button>
              <div className="todo-item-meta">
                {item.projectId && <span className="todo-tag"><AppIcon name="folder" size={12} />{item.projectName ?? '关联项目'}{item.projectStatus !== 'active' ? ' · 已停用' : ''}</span>}
                {running && <span className="todo-active-label"><i />计时中</span>}
                {item.plannedOn && !done && (overdue || later) && <time dateTime={item.plannedOn}>计划 {item.plannedOn}</time>}
                {item.spentMillis > 0 && <span><AppIcon name="clock" size={12} />{duration(item.spentMillis)}</span>}
                {item.dueAt !== null && <time dateTime={new Date(item.dueAt).toISOString()}>截止 {new Date(item.dueAt).toLocaleDateString('zh-CN')}</time>}
              </div>
            </div>
            <div className="todo-item-actions">
              {!done && <Button size="sm" variant="quiet" disabled={busy}
                onClick={() => running ? onPause() : later ? onPlan(item) : onStart(item)}>
                <AppIcon name={running ? 'pause' : later ? 'clock' : 'play'} size={14} />{running ? '暂停' : later ? '今天做' : '开始'}
              </Button>}
              {overdue && <Button size="sm" variant="quiet" disabled={busy} aria-label={`移除 ${item.title} 的计划日期`}
                title="移除计划日期" onClick={() => onClearPlan(item)}><AppIcon name="close" size={14} /></Button>}
            </div>
          </li>
        )
      })}</ul> : <p className="todo-empty">{empty}</p>}
    </section>
  )
}
