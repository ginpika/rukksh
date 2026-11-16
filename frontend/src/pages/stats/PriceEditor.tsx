import { useEffect, useRef, useState, type FormEvent } from 'react'
import { deleteStatsPrice, loginUrlOf, saveStatsPrice, type StatsModel, type StatsPrice, type StatsView } from '../../api/client'
import { Button } from '../../components/ui'
import { DraftNotice } from '../../components/DraftNotice'
import { Select } from '../../components/Select'
import { resetWindowStates, useDraftState, useRememberedState } from '../../components/windowState'
import { amount, statsError } from './format'

type PriceDraft = StatsModel & { effectiveFrom: string; currency: string; input: string; output: string; cached: string }
type PriceOperation = { kind: 'save' } | { kind: 'delete'; id: number }

const versionKey = (id: number) => `stats:price-version:${id}`
const draftFromVersion = (price: StatsPrice): PriceDraft => ({
  provider: price.provider, model: price.model, effectiveFrom: price.effectiveFrom, currency: price.currency,
  input: String(price.inputPerMillion), output: String(price.outputPerMillion),
  cached: price.cachedPerMillion === null ? '' : String(price.cachedPerMillion),
})

export function PriceEditor({ data, target, onSaved }: {
  data: StatsView; target: StatsModel | null; onSaved: () => void
}) {
  const providerInput = useRef<HTMLInputElement>(null)
  const [loadedVersion, setLoadedVersion] = useState<StatsPrice | null>(null)
  const version = data.prices.find(price => price.id === loadedVersion?.id) ?? loadedVersion
  const draftKey = version ? versionKey(version.id) : `stats:price-new:${JSON.stringify(target && [target.provider, target.model])}`
  const [draft, setDraft, { initialize, accept, discard, dirty }] = useDraftState<PriceDraft>(draftKey, () => version ? draftFromVersion(version) : ({
    provider: target?.provider ?? '', model: target?.model ?? '', effectiveFrom: data.today, currency: 'CNY',
    input: '', output: '', cached: '',
  }))
  const { provider, model, effectiveFrom, currency, input, output, cached } = draft
  const [operation, setOperation] = useRememberedState<PriceOperation | null>('stats:price-mutation', null)
  const busy = operation !== null
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  useEffect(() => {
    if (version) initialize(draftFromVersion(version))
  }, [version, initialize])

  function change(field: keyof PriceDraft, value: string) {
    setDraft(current => ({ ...current, [field]: value }))
    setNotice('')
    setError(null)
  }
  function load(price: StatsPrice | null) {
    setLoadedVersion(price)
    setNotice('')
    setError(null)
    setConfirmDelete(null)
    providerInput.current?.focus()
  }
  async function remove(id: number) {
    if (busy) return
    if (confirmDelete !== id) { setConfirmDelete(id); return }
    setOperation({ kind: 'delete', id }); setError(null); setNotice('')
    try {
      await deleteStatsPrice(id)
      resetWindowStates(versionKey(id))
      if (version?.id === id) setLoadedVersion(null)
      setConfirmDelete(null)
      setNotice('价格版本已删除，费用估算会随统计刷新。')
      onSaved()
    }
    catch (e) { const login = loginUrlOf(e); if (login) window.location.assign(login); else setError(statsError(e)) }
    finally { setOperation(null) }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null); setNotice(''); setConfirmDelete(null)
    if (!input.trim() || !output.trim()) { setError('请填写输入和输出单价；明确免费时填写 0'); return }
    setOperation({ kind: 'save' })
    try {
      await saveStatsPrice({ provider, model, effectiveFrom, currency, inputPerMillion: input,
        outputPerMillion: output, cachedPerMillion: cached.trim() || null })
      if (version && (provider.trim() !== version.provider || model.trim() !== version.model || effectiveFrom !== version.effectiveFrom)) {
        accept(draftFromVersion(version), draft)
        setLoadedVersion(null)
      } else {
        accept(draft, draft)
      }
      setNotice('价格已保存，费用估算会随统计刷新。')
      onSaved()
    } catch (e) {
      const login = loginUrlOf(e)
      if (login) { window.location.assign(login); return }
      setError(statsError(e))
    } finally { setOperation(null) }
  }
  return (
    <div className="usage-price">
      <div>
        <p>填写供应商实际采用的每百万 Token 单价。此表单仅支持按 Token 计费，按请求、订阅或其他规则计费的模型请保持未计价。</p>
        <p className="usage-secondary">价格在 {data.timeZone} 的生效日零点起适用，直到下一版本生效。更正或删除价格版本会重新估算历史费用。实付金额以供应商账单为准。</p>
      </div>
      <form onSubmit={save} aria-label="模型价格配置">
        <div className="usage-price__mode">
          <h3>{version ? '编辑价格版本' : '新建价格版本'}</h3>
          {version && <Button variant="quiet" disabled={busy} onClick={() => load(null)}>返回新建</Button>}
        </div>
        {version && <p className="usage-secondary usage-price__version-hint">更改端点、模型名或生效日期会另存价格版本。</p>}
        <DraftNotice dirty={dirty} onDiscard={() => { discard(); setNotice(''); setError(null) }} disabled={busy} />
        <fieldset className="usage-price__fields" disabled={busy}>
          <label className="usage-field usage-field--wide">
            <span>供应商端点</span>
            <input ref={providerInput} value={provider} onChange={e => change('provider', e.target.value)} placeholder="https://api.example.com/v1" maxLength={2000} />
            <small>留空仅匹配供应商未知的历史记录。不要填写密钥。</small>
          </label>
          <label className="usage-field">
            <span>模型名</span>
            <input required value={model} onChange={e => change('model', e.target.value)} maxLength={300} />
          </label>
          <label className="usage-field">
            <span>生效日期</span>
            <input required type="date" min="1970-01-01" value={effectiveFrom} onChange={e => change('effectiveFrom', e.target.value)} />
          </label>
          <div className="usage-field">
            <span>币种</span>
            <Select
              label="币种"
              value={currency}
              onChange={value => change('currency', value)}
              disabled={busy}
              size="compact"
              options={[...new Set(['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD', currency])].map(c => ({ value: c, label: c }))}
            />
          </div>
          <label className="usage-field">
            <span>输入 / 百万 Token</span>
            <input required type="number" min="0" max="1000000000" step="0.00000001" value={input} onChange={e => change('input', e.target.value)} placeholder="未配置" />
          </label>
          <label className="usage-field">
            <span>输出 / 百万 Token</span>
            <input required type="number" min="0" max="1000000000" step="0.00000001" value={output} onChange={e => change('output', e.target.value)} placeholder="未配置" />
          </label>
          <label className="usage-field">
            <span>缓存命中 / 百万 Token</span>
            <input type="number" min="0" max="1000000000" step="0.00000001" value={cached} onChange={e => change('cached', e.target.value)} placeholder="未知，可留空" />
            <small>有缓存用量而缓存单价未知时，该调用不计价。</small>
          </label>
        </fieldset>
        <div className="usage-actions">
          <Button type="submit" variant="primary" disabled={busy}>{operation?.kind === 'save' ? '正在保存…' : '保存价格版本'}</Button>
          {notice && <span className="usage-success" role="status">{notice}</span>}
        </div>
        {error && <p role="alert" className="usage-error">{error}</p>}
      </form>
      {data.prices.length > 0 && (
        <details>
          <summary>已保存的价格版本（{data.prices.length}）</summary>
          <div className="usage-table-wrap scrollbar-slim" tabIndex={0} role="region" aria-label="价格版本，可横向滚动">
            <table className="usage-table">
              <thead>
                <tr><th>模型 / 端点</th><th>生效日期</th><th>币种</th><th>输入</th><th>输出</th><th>缓存命中</th><th>操作</th></tr>
              </thead>
              <tbody>
                {data.prices.map(p => (
                  <tr key={p.id}>
                    <th scope="row">{p.model}<small>{p.provider || '供应商未知（历史）'}</small></th>
                    <td>{p.effectiveFrom}</td>
                    <td>{p.currency}</td>
                    <td>{amount(p.inputPerMillion)}</td>
                    <td>{amount(p.outputPerMillion)}</td>
                    <td>{p.cachedPerMillion === null ? '未配置' : amount(p.cachedPerMillion)}</td>
                    <td>
                      <div className="usage-actions">
                        <Button type="button" disabled={busy} onClick={() => load(p)}>载入编辑</Button>
                        <Button type="button" variant="danger" disabled={busy} onClick={() => remove(p.id)}>
                          {operation?.kind === 'delete' && operation.id === p.id ? '正在删除…' : confirmDelete === p.id ? '确认删除此版本' : '删除'}
                        </Button>
                        {confirmDelete === p.id && <Button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}>取消</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
