import type { TodoReview } from '../../api/todo'
import { AppIcon } from '../../components/AppIcon'
import { Button } from '../../components/ui'
import { dayLabel, duration } from './format'

export default function TodoHistory({ review, onDetail, onNote }: { review: TodoReview; onDetail: (id: string) => void; onNote: (day: string) => void }) {
  return (
    <>
      <dl className="todo-review-stats">
        <div><dt>已完成</dt><dd>{review.completedCount}</dd></div>
        <div><dt>已放下</dt><dd>{review.droppedCount}</dd></div>
        <div><dt>已记录投入</dt><dd>{duration(review.spentMillis)}</dd></div>
        <div><dt>有投入的天数</dt><dd>{review.activeDays}</dd></div>
      </dl>
      <div className="todo-columns">
        <div className="todo-primary">
          <section className="todo-list-section">
            <header className="todo-section-heading"><h2>已结束的待办</h2></header>
            {review.closed.length ? <ol className="todo-memory-list" role="list">{review.closed.map(item => (
              <li key={item.id}>
                <AppIcon name={item.state === 'done' ? 'success' : 'archive'} />
                <div>
                  <h3><button type="button" onClick={() => onDetail(item.id)}>{item.title}</button></h3>
                  <div className="todo-item-meta">
                    <span>{item.closedAt !== null && `${dayLabel(item.closedAt)} · `}{item.state === 'done' ? '已完成' : '已放下'}</span>
                    {item.projectId && <span className="todo-tag"><AppIcon name="folder" size={12} />{item.projectName}</span>}
                    {item.spentMillis > 0 && <span><AppIcon name="clock" size={12} />{duration(item.spentMillis)}</span>}
                  </div>
                  {item.note && <p className="todo-prose">{item.note}</p>}
                </div>
              </li>
            ))}</ol> : <p className="todo-empty">本月还没有结束的待办。</p>}
          </section>
          {review.notes.length > 0 && <section className="todo-list-section">
            <header className="todo-section-heading"><h2>每日记录</h2></header>
            {review.notes.map(note => <article className="todo-past-note" key={note.day}>
              <button type="button" onClick={() => onNote(note.day)}><time dateTime={note.day}>{note.day}</time><AppIcon name="edit" size={14} /></button>
              <p className="todo-prose">{note.body}</p>
            </article>)}
          </section>}
        </div>
        <aside className="todo-support" aria-label="月度投入">
          <section>
            <header className="todo-section-heading"><h2>投入分布</h2></header>
            {review.allocations.length ? <div className="todo-month-allocation">{review.allocations.map(item => (
              <div key={item.todoId} className="todo-allocation">
                <div><button type="button" onClick={() => onDetail(item.todoId)}>{item.title}</button><span>{duration(item.millis)}</span></div>
                <div className="todo-allocation-track"><span style={{ width: `${review.spentMillis ? item.millis / review.spentMillis * 100 : 0}%` }} /></div>
              </div>
            ))}</div> : <p className="todo-secondary">本月还没有投入记录。</p>}
          </section>
          {review.footprints.length > 0 && <section className="todo-footprints">
            <header className="todo-section-heading"><h2>活动记录</h2></header>
            {review.footprints.map(item => <article key={`${item.todoId}:${item.occurredAt}:${item.detail}`}>
              <h3>{item.title}</h3><p>{item.detail}</p>
              <Button size="sm" variant="quiet" onClick={() => onDetail(item.todoId)}>查看待办<AppIcon name="arrow-right" /></Button>
            </article>)}
          </section>}
        </aside>
      </div>
    </>
  )
}
