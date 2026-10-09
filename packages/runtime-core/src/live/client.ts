/** Shared browser behavior; the server renderer remains authoritative. */
export const LIVE_CLIENT_RUNTIME = `<script>
(() => {
  const initial = document.querySelector('[data-zebric-live-cursor]')
  if (!initial) return
  let cursor = initial.dataset.zebricLiveCursor
  let pending = false, refreshing = false, stopped = false, revision = 0
  let debounce, pollTimer, source
  const baselines = new Map(), submissions = new Map()
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.dataset.zebricLiveStatus = ''
  status.style.cssText = 'position:fixed;bottom:1rem;right:1rem;font-size:.75rem;opacity:.75;pointer-events:none'
  document.body.append(status)
  const state = text => { status.textContent = text }
  const main = () => document.getElementById('main-content')
  const fingerprint = form => JSON.stringify(Array.from(form.elements).filter(el =>
    el.matches('input,textarea,select') && el.type !== 'hidden' && el.type !== 'submit'
  ).map(el => [el.name, el.value, el.checked, el.type === 'file' ? Array.from(el.files).map(f => [f.name, f.size, f.lastModified]) : null,
    el.tagName === 'SELECT' ? Array.from(el.selectedOptions).map(o => o.value) : null]))
  const remember = () => {
    baselines.clear(); submissions.clear()
    main()?.querySelectorAll('form').forEach(form => baselines.set(form, fingerprint(form)))
  }
  const dirty = () => {
    if (main()?.querySelector('[data-zebric-inline-edit]')) return true
    for (const [form, baseline] of baselines) {
      if (form.isConnected && (fingerprint(form) !== baseline || submissions.has(form))) return true
    }
    return false
  }
  const endpoint = () => '/_zebric/live?' + new URLSearchParams({ path: location.pathname + location.search, cursor })
  const stop = () => { stopped = true; source?.close(); clearTimeout(pollTimer); clearTimeout(debounce) }
  const schedule = () => {
    if (!pending || stopped) return
    clearTimeout(debounce)
    debounce = setTimeout(refresh, 150)
  }
  const invalidate = event => {
    if (event.cursor === cursor && !pending) return
    pending = true; revision++; schedule()
  }
  async function refresh() {
    if (stopped || refreshing || !pending || dirty()) return
    refreshing = true
    state('Updating')
    const started = revision
    try {
      const response = await fetch(location.href, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } })
      if (response.status === 401 || response.status === 403 || response.redirected) { stop(); state('Reconnecting'); return }
      if (!response.ok) throw new Error('Refresh failed')
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
      const next = doc.querySelector('#main-content[data-zebric-live-cursor]')
      if (!next) { stop(); state('Reconnecting'); return }
      // Input may have changed while the projection was being fetched.
      if (dirty() || stopped) return
      const focused = document.activeElement
      const focusId = focused?.id
      const focusName = focused?.getAttribute('name')
      const selection = typeof focused?.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null
      const scroll = [window.scrollX, window.scrollY]
      main().replaceWith(next)
      document.title = doc.title
      cursor = next.dataset.zebricLiveCursor
      remember()
      document.dispatchEvent(new CustomEvent('zebric:enhance'))
      const restored = focusId ? document.getElementById(focusId) : focusName ? Array.from(main().querySelectorAll('[name]')).find(el => el.getAttribute('name') === focusName) : null
      restored?.focus({ preventScroll: true })
      if (selection && restored?.setSelectionRange) try { restored.setSelectionRange(...selection) } catch (_) {}
      window.scrollTo(...scroll)
      pending = revision !== started
      state('Live')
    } catch (_) { state('Reconnecting') }
    finally { refreshing = false; if (pending && !dirty()) { clearTimeout(debounce); debounce = setTimeout(refresh, 1000) } }
  }
  async function poll() {
    if (stopped) return
    try {
      const response = await fetch(endpoint() + '&transport=poll', { credentials: 'same-origin', cache: 'no-store' })
      if ([401,403,404].includes(response.status)) { stop(); state('Reconnecting'); return }
      if (!response.ok) throw new Error('Connection failed')
      const event = await response.json()
      if (event.type === 'invalidate') invalidate(event)
      else if (!pending && !refreshing) cursor = event.cursor
      if (!refreshing) state('Live')
    } catch (_) { state('Reconnecting') }
    finally { if (!stopped) pollTimer = setTimeout(poll, 2000) }
  }
  document.addEventListener('input', schedule)
  document.addEventListener('change', schedule)
  document.addEventListener('zebric:inline-edit-settled', schedule)
  document.addEventListener('reset', e => setTimeout(() => {
    if (e.defaultPrevented) return
    if (baselines.has(e.target)) baselines.set(e.target, fingerprint(e.target))
    submissions.delete(e.target); schedule()
  }, 0))
  document.addEventListener('submit', e => {
    if (baselines.has(e.target)) submissions.set(e.target, fingerprint(e.target))
  })
  document.addEventListener('zebric:form-settled', e => {
    const form = e.target
    if (e.detail?.success && submissions.get(form) === fingerprint(form)) baselines.set(form, fingerprint(form))
    submissions.delete(form); schedule()
  })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pending = true; revision++; schedule() } })
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload() })
  window.addEventListener('pagehide', stop)
  remember(); state('Reconnecting')
  if (typeof EventSource === 'function') {
    source = new EventSource(endpoint())
    source.onopen = () => state('Live')
    source.addEventListener('invalidate', e => { try { invalidate(JSON.parse(e.data)) } catch (_) {} })
    source.addEventListener('unavailable', () => { stop(); state('Reconnecting') })
    source.onerror = () => { source.close(); state('Reconnecting'); poll() }
  } else poll()
})()
</script>`
