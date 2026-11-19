import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import emojiDataUrl from 'emojibase-data/zh/compact.json?url'
import { ArrowLeft, Search, Smile } from 'lucide-react'

type CompactEmoji = typeof import('emojibase-data/zh/compact.json').default[number]

const GROUPS = ['笑脸与情绪', '人物与身体', '肤色与发型', '动物与自然', '食物与饮料', '旅行与地点', '活动', '物品', '符号', '旗帜']
const ALIASES: Record<string, string | undefined> = { '😀': '笑脸', '😂': '笑哭', '👍': '点赞', '❤️': '爱心' }
const ARROW_STEPS: Record<string, number | undefined> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\uFE0F/g, '')
let emojiCatalog: Promise<CompactEmoji[]> | undefined

function fetchEmojiCatalog() {
  return emojiCatalog ??= fetch(emojiDataUrl).then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const entries: CompactEmoji[] = await response.json()
    // Ungrouped regional indicators only appear in combination as flags in the RGI set.
    return entries.filter(emoji => emoji.group !== undefined)
  }).catch((error: unknown) => {
    emojiCatalog = undefined
    throw error
  })
}

function matchingEmoji(data: CompactEmoji[], query: string) {
  const words = query.split(/\s+/)
  const matches: CompactEmoji[] = []
  for (const emoji of data) {
    if (normalize(emoji.unicode) === query) return [emoji]
    const exactSkin = emoji.skins?.find(skin => normalize(skin.unicode) === query)
    if (exactSkin) return [exactSkin]
    const keywords = normalize([emoji.label, ALIASES[emoji.unicode], ...(emoji.tags ?? [])].join('\n'))
    if (words.every(word => keywords.includes(word)) || emoji.skins?.some(skin => {
      const name = normalize(skin.label)
      return words.every(word => keywords.includes(word) || name.includes(word))
    })) matches.push(emoji)
  }
  return matches
}

export default function ComposerEmojiPicker({ disabled, onSelect }: {
  disabled: boolean
  onSelect: (emoji: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<CompactEmoji[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [group, setGroup] = useState(0)
  const [query, setQuery] = useState('')
  const [variant, setVariant] = useState<CompactEmoji | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const keyboardOpened = useRef(false)
  const variantIndex = useRef(0)
  const pendingFocus = useRef<number | null>(null)
  const visible = open && !disabled
  const search = normalize(query.trim())
  const results = useMemo(() => {
    if (!visible || !data) return []
    return search ? matchingEmoji(data, search) : data.filter(emoji => emoji.group === group)
  }, [visible, data, search, group])
  const options = variant ? [variant, ...(variant.skins ?? [])] : results

  useEffect(() => {
    if (!visible) return
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    const initialFocus = keyboardOpened.current ? searchInput.current : panel.current
    initialFocus?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
    }
  }, [visible])

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return
    grid.current?.querySelectorAll('button')[pendingFocus.current]?.focus()
    pendingFocus.current = null
  }, [variant])

  const loadEmoji = async () => {
    setLoadError(false)
    try {
      setData(await fetchEmojiCatalog())
    } catch {
      setLoadError(true)
    }
  }
  const show = (fromKeyboard: boolean) => {
    keyboardOpened.current = fromKeyboard
    setQuery('')
    setVariant(null)
    setOpen(true)
    if (!data) void loadEmoji()
  }
  const close = () => {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }
  const back = () => {
    pendingFocus.current = variantIndex.current
    setVariant(null)
  }
  const choose = (emoji: CompactEmoji, index: number) => {
    if (!variant && emoji.skins?.length) {
      variantIndex.current = index
      pendingFocus.current = 0
      setVariant(emoji)
      return
    }
    setOpen(false)
    onSelect(emoji.unicode)
  }
  const searchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      grid.current?.querySelector('button')?.focus()
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (search && results[0]) choose(results[0], 0)
    }
  }
  const gridKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEPS[event.key]
    if (step === undefined || !(event.target instanceof HTMLButtonElement)) return
    event.preventDefault()
    const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
    buttons[buttons.indexOf(event.target) + step]?.focus()
  }

  return <div ref={root} onKeyDown={event => {
    if (!visible || event.key !== 'Escape' || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    if (variant) back()
    else close()
  }}>
    <button ref={trigger} type="button" className="sl-emoji__trigger" disabled={disabled}
      title="添加表情" aria-label="添加表情" aria-haspopup="dialog" aria-expanded={visible}
      aria-controls={visible ? id : undefined}
      onMouseDown={event => event.preventDefault()} onClick={event => visible ? close() : show(event.detail === 0)}>
      <Smile size={17} aria-hidden="true" />
    </button>
    {visible && <div ref={panel} id={id} tabIndex={-1} role="dialog" aria-label="选择表情" className="sl-emoji__panel">
      {variant ? <div className="sl-emoji__toolbar">
        <button type="button" className="sl-emoji__back" aria-label="返回表情列表"
          onMouseDown={event => event.preventDefault()} onClick={back}><ArrowLeft size={16} aria-hidden="true" /></button>
        <span>{variant.label} · 选择肤色</span>
      </div> : <div className="sl-emoji__toolbar">
        <label className="sl-emoji__search"><Search size={15} aria-hidden="true" />
          <input ref={searchInput} type="search" aria-label="搜索表情" placeholder="搜索表情…" value={query}
            autoComplete="off" enterKeyHint="search"
            onKeyDown={searchKeys} onChange={event => {
              setQuery(event.target.value)
              if (grid.current) grid.current.scrollTop = 0
            }} />
        </label>
        <select aria-label="表情分类" value={search ? '' : group} onChange={event => {
          setGroup(Number(event.target.value))
          setQuery('')
          if (grid.current) grid.current.scrollTop = 0
        }}>
          {search && <option value="" disabled>全部分类</option>}
          {GROUPS.map((label, index) => <option value={index} key={label}>{label}</option>)}
        </select>
      </div>}
      {options.length > 0 ? <div key={variant?.unicode ?? 'results'} ref={grid} className="sl-emoji__grid scrollbar-slim" onKeyDown={gridKeys}>
        {options.map((emoji, index) => {
          const hasVariants = !variant && Boolean(emoji.skins?.length)
          const label = hasVariants ? `${emoji.label}，选择肤色`
            : variant && index === 0 ? `${emoji.label}，默认肤色` : emoji.label
          return <button key={emoji.unicode} type="button" className="sl-emoji__option" tabIndex={index === 0 ? 0 : -1}
            data-variants={hasVariants || undefined} title={label} aria-label={label} onMouseDown={event => event.preventDefault()}
            onClick={() => choose(emoji, index)}>{emoji.unicode}</button>
        })}
      </div> : <div className="sl-emoji__status" role="status">
        {loadError ? <><span>表情加载失败</span><button type="button" onClick={loadEmoji}>重试</button></>
          : data ? '没有找到表情' : '正在加载表情…'}
      </div>}
    </div>}
  </div>
}
