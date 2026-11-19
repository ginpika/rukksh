import { useLayoutEffect, useRef, useState } from 'react'
import { CornerDownLeft, Search, X } from 'lucide-react'
import { loginUrlOf, search, type SearchResponse } from '../../api/client'
import ResultCard from '../../components/ResultCard'
import WebSearchResults from '../../components/WebSearchResults'
import './homeSearch.css'

type SearchState = { query: string } & (
  { status: 'loading' | 'error' } | { status: 'ready'; response: SearchResponse }
)

function SearchMatches({ query, response }: { query: string; response: SearchResponse }) {
  const { hits, web } = response
  const showWeb = web?.enabled && Boolean(web.results.length || web.error || web.warnings?.length)

  return <>
    {!hits.length && !showWeb && <p className="sl-search__message">未找到与「{query}」匹配的结果。</p>}
    {hits.length > 0 && <section aria-label="知识库结果">
      <h2>知识库</h2>
      {hits.map((hit, i) => <ResultCard key={`${hit.kind}-${hit.chunkId ?? hit.entityId ?? i}`} hit={hit} compact />)}
    </section>}
    {showWeb && <WebSearchResults web={web} compact />}
  </>
}

export default function HomeSearch({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const backdropPress = useRef(false)
  const [query, setQuery] = useState('')
  const [rag, setRag] = useState(false)
  const [state, setState] = useState<SearchState | null>(null)
  const text = query.trim()

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    inputRef.current?.focus({ preventScroll: true })
    return () => {
      requestRef.current?.abort()
      dialog?.close()
    }
  }, [])

  async function runSearch(query: string, rag: boolean) {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setState({ status: 'loading', query })
    resultsRef.current?.scrollTo(0, 0)
    try {
      const response = await search(query, rag, controller.signal)
      if (!controller.signal.aborted) setState({ status: 'ready', query, response })
    } catch (error) {
      if (controller.signal.aborted) return
      const loginUrl = loginUrlOf(error)
      if (loginUrl) window.location.assign(loginUrl)
      else setState({ status: 'error', query })
    }
  }

  function selectMode(nextRag: boolean) {
    if (rag === nextRag) return
    setRag(nextRag)
    if (state && text) void runSearch(text, nextRag)
    else {
      requestRef.current?.abort()
      setState(null)
    }
  }

  const loading = state?.status === 'loading'
  const canSubmit = Boolean(text) && !(loading && state.query === text)
  const count = state?.status === 'ready' ? state.response.hits.length + (state.response.web?.results.length ?? 0) : null

  return <dialog
    ref={dialogRef}
    id="rukksh-home-search"
    className="sl-search"
    aria-label="知识库与网页搜索"
    onCancel={event => { event.preventDefault(); onClose() }}
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget }}
    onClick={event => { if (backdropPress.current && event.target === event.currentTarget) onClose() }}
    onKeyDown={event => {
      const composing = event.nativeEvent.isComposing || event.keyCode === 229
      if (event.key === 'Enter' && composing) event.preventDefault()
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (!composing) onClose()
    }}
  >
    <div className="sl-search__stack" data-searched={state !== null}>
      <div className="sl-search__modes" data-rag={rag} role="group" aria-label="搜索模式">
        <label>
          <input className="sr-only" type="radio" name="home-search-mode" checked={!rag} onChange={() => selectMode(false)} />
          <span>网页搜索</span>
        </label>
        <label>
          <input className="sr-only" type="radio" name="home-search-mode" checked={rag} onChange={() => selectMode(true)} />
          <span>RAG 片段</span>
        </label>
      </div>
      <form role="search" className="sl-search__field" onSubmit={event => {
        event.preventDefault()
        if (canSubmit) void runSearch(text, rag)
      }}>
        <Search size={19} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          aria-label="搜索关键词"
          placeholder={rag ? '搜索知识库片段…' : '搜索知识库和网页…'}
          value={query}
          autoComplete="off"
          onChange={event => setQuery(event.target.value)}
        />
        <button type="submit" aria-label="提交搜索" title="搜索（Enter）" disabled={!canSubmit}>
          <CornerDownLeft size={18} aria-hidden="true" />
        </button>
      </form>
      <span className="sr-only" role="status">
        {loading ? '正在搜索…' : count !== null ? `找到 ${count} 条结果` : ''}
      </span>
      {state && <div ref={resultsRef} className="sl-search__results scrollbar-slim" aria-busy={loading}>
        {state.status === 'loading' && <p className="sl-search__message">正在搜索…</p>}
        {state.status === 'error' && <div className="sl-search__message">
          <span role="alert">搜索失败。</span>
          <button type="button" onClick={() => void runSearch(state.query, rag)}>重试</button>
        </div>}
        {state.status === 'ready' && <SearchMatches query={state.query} response={state.response} />}
      </div>}
    </div>
    <button type="button" className="sl-search__close" aria-label="关闭搜索" title="关闭搜索（Esc）" onClick={onClose}>
      <X size={19} aria-hidden="true" />
    </button>
  </dialog>
}
