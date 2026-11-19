import { useEffect, useId, useRef, type ReactNode } from 'react'
import { BRAND } from '../branding'
import PageBackLink from './PageBackLink'
import { RukkshAppearanceButton } from './RukkshAppearance'
import './rukkshPage.css'

export default function RukkshPage({ title, backHref, backLabel, onBack, className, children }: {
  title: string
  backHref: string
  backLabel: string
  onBack?: (href: string) => void
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
    <div className={className ? `sl-page rukksh-surface ${className}` : 'sl-page rukksh-surface'}>
      <header className="sl-page__header" data-tauri-drag-region>
        <PageBackLink className="sl-page__back" backHref={backHref} backLabel={backLabel} onBack={onBack} />
        <h1 id={titleId} ref={headingRef} tabIndex={-1} data-tauri-drag-region>{title}</h1>
        <RukkshAppearanceButton />
      </header>
      <main className="sl-page__main scrollbar-slim" aria-labelledby={titleId}>{children}</main>
    </div>
  )
}
