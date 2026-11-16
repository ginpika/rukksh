import { useEffect, useRef, type ReactNode } from 'react'
import { AppIcon } from '../../components/AppIcon'
import { SlimeAppearanceButton } from '../../components/SlimeAppearance'

export default function CodingToolbar({ children, actions, onChooseProject, projectTabId, backHref = '#/dashboard', backLabel = '返回 Dashboard' }: {
  children?: ReactNode
  actions?: ReactNode
  onChooseProject?: () => void
  projectTabId?: string
  backHref?: string
  backLabel?: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (document.activeElement === document.body) heading.current?.focus({ preventScroll: true })
  }, [])

  return (
    <header className="coding-toolbar" data-tauri-drag-region>
      <a className="coding-toolbar-icon" href={backHref} aria-label={backLabel} title={backLabel}>
        <AppIcon name="arrow-left" size={18} />
      </a>
      <h1 ref={heading} tabIndex={-1} data-tauri-drag-region>AI IDE</h1>
      {onChooseProject && (
        <button type="button" className="coding-switch-project" aria-controls={projectTabId}
          aria-label="切换项目" title="切换项目" onClick={onChooseProject}>
          <AppIcon name="folder" /><span>切换项目</span>
        </button>
      )}
      {children}
      <div className="coding-toolbar-actions">
        {actions}
        <SlimeAppearanceButton />
      </div>
    </header>
  )
}
