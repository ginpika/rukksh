const PREVIOUS_PAGE = 'rukkshPreviousPage'

export function getPreviousPageHash(): string | null {
  return window.history.state?.[PREVIOUS_PAGE] ?? null
}

export function trackPageHistory() {
  const recordPreviousPage = (hash: string | null) => {
    const state = window.history.state ?? {}
    if (!Object.hasOwn(state, PREVIOUS_PAGE)) {
      window.history.replaceState({ ...state, [PREVIOUS_PAGE]: hash }, '')
    }
  }

  // Give the initial entry a marker too, so traversing back to it never records a forward link.
  recordPreviousPage(null)
  let currentHash = window.location.hash
  const track = () => {
    const nextHash = window.location.hash
    if (nextHash === currentHash) return
    recordPreviousPage(currentHash || '#/')
    currentHash = nextHash
  }
  window.addEventListener('popstate', track)
  window.addEventListener('hashchange', track)
}

export function replacePageHash(hash: string) {
  const oldURL = window.location.href
  window.history.replaceState(window.history.state, '', hash)
  const newURL = window.location.href
  // replaceState keeps the current entry's back destination and doesn't emit a hashchange itself.
  if (newURL !== oldURL) window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL }))
}
