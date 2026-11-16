import { useEffect, useRef, useState } from 'react'

type SettingsDirectoryItem = { id: string; text: string }

function sectionOffset(section: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(section).scrollMarginBlockStart) || 0
}

export default function SettingsDirectory({ items }: { items: SettingsDirectoryItem[] }) {
  const navRef = useRef<HTMLElement>(null)
  const jumpPosition = useRef<{ id: string; top: number } | null>(null)
  const [activeId, setActiveId] = useState(items[0]?.id)

  useEffect(() => {
    const scroller = navRef.current?.closest('main')
    if (!scroller) return
    const sections = items.flatMap(item => {
      const section = document.getElementById(item.id)
      return section ? [section] : []
    })

    const update = () => {
      const requested = jumpPosition.current
      if (requested && Math.abs(scroller.scrollTop - requested.top) < 2) {
        setActiveId(requested.id)
        return
      }
      jumpPosition.current = null
      const top = scroller.getBoundingClientRect().top
      const first = sections[0]
      const last = sections.at(-1)
      let current = first?.id
      for (const section of sections) {
        if (section.getBoundingClientRect().top - top <= sectionOffset(section) + 2) current = section.id
      }
      if (last && scroller.scrollTop > 0 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 2) current = last.id
      setActiveId(current)
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    for (const section of sections) observer.observe(section)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [items])

  function jump(id: string) {
    const scroller = navRef.current?.closest('main')
    const section = document.getElementById(id)
    if (!scroller || !section) return

    const distance = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const top = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + distance - sectionOffset(section)))
    // Keep the chosen section current if several anchors share the same clamped scroll position.
    jumpPosition.current = { id, top }
    scroller.scrollTo({ top })
    section.querySelector('h2')?.focus({ preventScroll: true })
    setActiveId(id)
  }

  const active = items.find(item => item.id === activeId)
  return (
    <nav ref={navRef} className="sl-settings__directory" aria-label="设置目录">
      <p className="sl-settings__directory-label">设置目录</p>
      <select aria-label="跳转到设置分区" value="" onChange={event => jump(event.target.value)}>
        <option value="" disabled>{active ? `跳转到分区 · ${active.text}` : '跳转到分区'}</option>
        {items.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}
      </select>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={activeId === item.id ? 'location' : undefined}
              aria-controls={item.id}
              onClick={() => jump(item.id)}
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
