import { useState, type ReactNode } from 'react'
import { AppIcon } from '../../components/AppIcon'

export type ProjectPickerContent = (menuHost: HTMLDivElement | null) => ReactNode

export default function CodingProjectTab({ id, active = true, onSelect, onClose }: {
  id: string
  active?: boolean
  onSelect?: () => void
  onClose: () => void
}) {
  const panelId = `${id}-panel`
  return (
    <div className={`coding-file-tab coding-project-tab${active ? ' is-active' : ''}`}>
      <button type="button" id={id} className="coding-project-tab-label" aria-current={active || undefined} aria-controls={panelId}
        onClick={onSelect ?? (() => document.getElementById(panelId)?.focus({ preventScroll: true }))}>
        <AppIcon name="folder-open" size={16} />打开项目
      </button>
      <button type="button" className="coding-close-tab" aria-label="关闭打开项目标签页" title="关闭标签页" onClick={onClose}>
        <AppIcon name="close" size={14} />
      </button>
    </div>
  )
}

export function CodingProjectTabPanel({ id, children, hidden }: {
  id: string
  children: ProjectPickerContent
  hidden?: boolean
}) {
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null)
  return (
    <div className="coding-project-tab-body" hidden={hidden}>
      <section id={`${id}-panel`} className="coding-project-tab-panel scrollbar-slim" aria-labelledby={id} tabIndex={-1}>
        <div className="coding-project-tab-content">
          <header className="coding-picker-intro">
            <span aria-hidden="true"><AppIcon name="folder-open" size={24} /></span>
            <div>
              <h2>打开项目</h2>
              <p>打开工作空间中的目录，或继续最近的编程项目。</p>
            </div>
          </header>
          {children(menuHost)}
        </div>
      </section>
      <div ref={setMenuHost} />
    </div>
  )
}
