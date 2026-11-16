import { useEffect, useId, useRef, type MouseEventHandler, type ReactNode } from 'react'
import { BRAND } from '../branding'
import { AppIcon } from './AppIcon'
import { SlimeAppearanceButton } from './SlimeAppearance'
import './slimePage.css'

export default function SlimePage({ title, backHref, backLabel, onBack, className, children }: {
  title: string
  backHref: string
  backLabel: string
  onBack?: MouseEventHandler<HTMLAnchorElement>
  className?: string
  children: ReactNode
}) {
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${title} · ${BRAND.name}`
    if (document.activeElement === document.body) headingRef.current?.focus({ preventScroll: true })
    return () => { document.title = previousTitle }
  }, [title])
  return (
    <div className={className ? `sl-page slime-surface ${className}` : 'sl-page slime-surface'}>
      <header className="sl-page__header" data-tauri-drag-region>
        <a className="sl-page__back" href={backHref} aria-label={backLabel} title={backLabel} onClick={onBack}>
          <AppIcon name="arrow-left" size={18} />
        </a>
        <h1 id={titleId} ref={headingRef} tabIndex={-1} data-tauri-drag-region>{title}</h1>
        <SlimeAppearanceButton />
      </header>
      <main className="sl-page__main scrollbar-slim" aria-labelledby={titleId}>{children}</main>
    </div>
  )
}
