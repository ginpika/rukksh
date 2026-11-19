import { useSyncExternalStore, type MouseEvent } from 'react'
import { getPreviousPageHash, replacePageHash } from '../shell/pageHistory'
import { AppIcon } from './AppIcon'

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export default function PageBackLink({ backHref, backLabel, className, onBack }: {
  backHref: string
  backLabel: string
  className: string
  onBack?: (href: string) => void
}) {
  const previousPage = useSyncExternalStore(subscribe, getPreviousPageHash, () => null)
  const label = previousPage ? '返回上一页' : backLabel

  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const previous = getPreviousPageHash()
    onBack?.(previous ?? backHref)
    if (previous) window.history.back()
    else replacePageHash(backHref)
  }

  return (
    <a className={className} href={previousPage ?? backHref} aria-label={label} title={label} onClick={goBack}>
      <AppIcon name="arrow-left" size={18} />
    </a>
  )
}
