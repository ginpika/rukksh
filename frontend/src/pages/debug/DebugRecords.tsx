import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { ContextManifest, SceneState } from '../../api/client'
import { AppIcon } from '../../components/AppIcon'
import { JsonViewer } from '../../components/JsonViewer'
import './debugRecords.css'

const countFormat = new Intl.NumberFormat('zh-CN')

function manifestKey({ executionId, round, retry, submission }: ContextManifest) {
  return `${executionId}-${round}-${retry}-${submission}`
}

function RecordTime({ value }: { value: number | string }) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <span>时间未知</span>
  return <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>
}

function CountList({ counts, empty }: { counts: Map<string, number>; empty: string }) {
  if (!counts.size) return <p className="debug-record-muted">{empty}</p>
  return (
    <ul className="debug-manifest-counts" role="list">
      {Array.from(counts, ([label, count]) => (
        <li key={label}><code>{label}</code><span>× {countFormat.format(count)}</span></li>
      ))}
    </ul>
  )
}

function ManifestDetail({ manifest }: { manifest: ContextManifest }) {
  const { selection } = manifest
  const sources = new Map<string, number>()
  const reasons = new Map<string, number>()
  for (const entry of selection.selected) {
    sources.set(entry.source, (sources.get(entry.source) ?? 0) + 1)
  }
  for (const entry of selection.omitted) {
    for (const reason of entry.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }

  return (
    <article className="debug-manifest-detail">
      <header className="debug-record-header">
        <div>
          <h3>Turn {manifest.turnId}</h3>
          <p className="debug-record-muted">第 {manifest.round + 1} 轮 · 重试 {manifest.retry} · 第 {manifest.submission} 次发送</p>
        </div>
        <p className="debug-record-muted"><RecordTime value={manifest.submittedAt} /></p>
      </header>

      <section className="debug-manifest-section">
        <h4>请求信息</h4>
        <dl className="debug-record-fields">
          <div><dt>模型</dt><dd>{manifest.model}</dd></div>
          <div><dt>估算输入</dt><dd>{countFormat.format(manifest.estimatedInputTokens)} Token</dd></div>
          <div><dt>正文大小</dt><dd>{countFormat.format(manifest.bodyBytes)} B</dd></div>
          <div><dt>消息</dt><dd>{countFormat.format(manifest.messageRoles.length)} 条</dd></div>
          <div className="debug-record-fields__wide"><dt>执行 ID · <code>[ctx]</code> 日志</dt><dd><code>{manifest.executionId}</code></dd></div>
        </dl>
      </section>

      <section className="debug-manifest-section">
        <h4>上下文选取</h4>
        <dl className="debug-record-fields">
          <div><dt>任务段</dt><dd>{selection.sceneId ?? '普通聊天'}</dd></div>
          <div><dt>授权代号</dt><dd>{selection.scopeRevision ?? 0}</dd></div>
          <div className="debug-record-fields__wide">
            <dt>Epoch</dt>
            <dd>{selection.epoch ? `#${selection.epoch.id} · ${selection.epoch.reason}` : '无'}</dd>
          </div>
        </dl>
        <div className="debug-manifest-breakdown">
          <section>
            <h5>入选来源 <span>{countFormat.format(selection.selected.length)} 个片段</span></h5>
            <CountList counts={sources} empty="暂无入选片段" />
          </section>
          <section>
            <h5>裁剪原因 <span>{countFormat.format(selection.omittedCount)} 个片段</span></h5>
            <CountList counts={reasons} empty={selection.omittedCount > 0 ? '记录未提供具体原因' : '暂无裁剪片段'} />
          </section>
        </div>
      </section>

      <details className="debug-manifest-json">
        <summary><AppIcon name="chevron-right" />查看完整选取 JSON</summary>
        <div className="debug-manifest-json__body scrollbar-slim" role="region" aria-label="完整选取 JSON" tabIndex={0}>
          <JsonViewer value={selection} openDepth={1} />
        </div>
      </details>
    </article>
  )
}

export function DebugManifests({ manifests }: { manifests: ContextManifest[] }) {
  const groupId = useId()
  const indexRef = useRef<HTMLElement>(null)
  const panelsRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)

  if (!manifests.length) {
    return (
      <p className="debug-record-empty">
        暂无出站记录。开启 <code>CONTEXT_EPHEMERAL_CHAT</code> 并发起一轮对话后可查看。
      </p>
    )
  }

  const keys = manifests.map(manifestKey)
  const active = selected === null ? 0 : Math.max(0, keys.indexOf(selected))

  function selectRecord(key: string) {
    setSelected(key)
    if (key === keys[active]) return
    const index = indexRef.current
    const panels = panelsRef.current
    if (index && panels && panels.getBoundingClientRect().top < index.getBoundingClientRect().top) {
      panels.scrollIntoView({ block: 'start' })
    }
  }

  function handleNavigation(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case 'ArrowDown': next = (index + 1) % manifests.length; break
      case 'ArrowUp': next = (index + manifests.length - 1) % manifests.length; break
      case 'Home': next = 0; break
      case 'End': next = manifests.length - 1; break
      default: return
    }
    event.preventDefault()
    selectRecord(keys[next])
    document.getElementById(`${groupId}-record-${next}`)?.focus()
  }

  return (
    <div className="debug-manifest">
      <label className="debug-manifest-picker">
        <span>最近出站</span>
        <select value={keys[active]} onChange={event => selectRecord(event.target.value)}>
          {manifests.map((manifest, index) => (
            <option key={keys[index]} value={keys[index]}>
              Turn {manifest.turnId} · 第 {manifest.round + 1} 轮 · 重试 {manifest.retry} · 发送 {manifest.submission}
            </option>
          ))}
        </select>
      </label>
      <section ref={indexRef} className="debug-manifest-index" aria-labelledby={`${groupId}-index`}>
        <header className="debug-record-header">
          <h3 id={`${groupId}-index`}>最近出站</h3>
          <span className="debug-record-muted">{countFormat.format(manifests.length)} 条</span>
        </header>
        <div className="debug-manifest-index__list scrollbar-slim" role="tablist" aria-orientation="vertical" aria-labelledby={`${groupId}-index`}>
          {manifests.map((manifest, index) => (
            <button
              type="button"
              role="tab"
              key={keys[index]}
              id={`${groupId}-record-${index}`}
              aria-selected={index === active}
              aria-controls={`${groupId}-detail-${index}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => selectRecord(keys[index])}
              onKeyDown={event => handleNavigation(event, index)}
            >
              <span className="debug-manifest-index__title">
                <strong>Turn {manifest.turnId}</strong>
                <span>{manifest.model}</span>
              </span>
              <span className="debug-record-muted">第 {manifest.round + 1} 轮 · 重试 {manifest.retry} · 发送 {manifest.submission}</span>
              <span className="debug-record-muted"><RecordTime value={manifest.submittedAt} /></span>
            </button>
          ))}
        </div>
      </section>

      <div className="debug-manifest-panels" ref={panelsRef}>
        {manifests.map((manifest, index) => (
          <section
            className="debug-manifest-panel"
            role="tabpanel"
            key={keys[index]}
            id={`${groupId}-detail-${index}`}
            aria-labelledby={`${groupId}-record-${index}`}
            hidden={index !== active}
            tabIndex={0}
          >
            {index === active && <ManifestDetail manifest={manifest} />}
          </section>
        ))}
      </div>
    </div>
  )
}

export function DebugScenes({ scenes }: { scenes: SceneState | null }) {
  const active = scenes?.active
  const resumable = scenes?.resumable ?? []

  return (
    <div className="debug-scenes">
      <section className="debug-scenes-section">
        <h3>当前任务段</h3>
        {active ? (
          <article className="debug-scene-active">
            <header>
              <AppIcon name="flow" size={19} />
              <div>
                <h4>{active.name || '未命名任务'}</h4>
                <p className="debug-record-muted"><code>#{active.id}</code> · 创建于 <RecordTime value={active.createdAt} /></p>
              </div>
            </header>
            {(active.rolePrompt || active.constraints) && (
              <dl className="debug-scene-active__details">
                {active.rolePrompt && <div><dt>角色</dt><dd>{active.rolePrompt}</dd></div>}
                {active.constraints && <div><dt>约束</dt><dd>{active.constraints}</dd></div>}
              </dl>
            )}
          </article>
        ) : <p className="debug-record-empty">普通聊天（无任务段）</p>}
      </section>
      <section className="debug-scenes-section">
        <h3>可恢复任务段</h3>
        {resumable.length ? (
          <ul className="debug-scene-list" role="list">
            {resumable.map(scene => (
              <li key={scene.id}>
                <div><strong>{scene.name || '未命名任务'}</strong><code>#{scene.id}</code></div>
                <p className="debug-record-muted"><RecordTime value={scene.createdAt} /></p>
              </li>
            ))}
          </ul>
        ) : <p className="debug-record-empty">暂无可恢复任务段</p>}
      </section>
    </div>
  )
}
