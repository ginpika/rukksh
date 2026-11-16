import { useState, type FormEvent } from 'react'
import type { DayNote } from '../../api/todo'
import { Button } from '../../components/ui'
import { todoError } from './format'

export default function DayNoteForm({ note, busy, onSave }: { note: DayNote; busy: boolean; onSave: (note: DayNote, body: string) => Promise<DayNote> }) {
  const [draft, setDraft] = useState(() => ({ base: note, body: note.body }))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const dirty = draft.body !== draft.base.body
  const ownDraft = dirty || (draft.base.day === note.day && draft.base.version > note.version)
  const base = ownDraft ? draft.base : note
  const body = ownDraft ? draft.body : note.body
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaved(false)
    try { const next = await onSave(base, body); setDraft({ base: next, body: next.body }); setSaved(true) }
    catch (error) { setError(todoError(error)) }
  }
  return <form className="todo-day-note" onSubmit={submit}>
    <label><span>{base.day === note.day ? '每日记录' : `${base.day} 的记录`}</span><textarea value={body} disabled={busy} maxLength={4000} rows={3} onChange={e => { setDraft({ base, body: e.target.value }); setSaved(false) }} placeholder="添加记录…" /></label>
    <div className="todo-actions"><Button size="sm" type="submit" disabled={busy || !dirty}>保存记录</Button><small role="status">{saved ? '已保存' : dirty ? `尚未保存 · ${base.day}` : note.day}</small></div>
    {error && <div className="todo-error" role="alert"><p>{error}</p><Button size="sm" onClick={() => { setDraft({ base: note, body: note.body }); setError('') }}>放弃修改并重新读取</Button></div>}
  </form>
}
