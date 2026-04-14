import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ZebricSimulatorRuntime,
  defaultSimulatorAccounts,
  type ApiSimulationPolicy,
  type PluginSimulationPolicy,
  type RenderResult,
  type SimulatorAccount,
  type SimulatorSeeds,
  type ZebricSimulatorState,
} from '@zebric/runtime-simulator'
import type { Blueprint } from '@zebric/runtime-core'

export interface ZebricSimulatorProps {
  blueprint?: Blueprint
  blueprintToml?: string
  blueprintJson?: string
  seeds?: SimulatorSeeds
  initialSeed?: string
  accounts?: SimulatorAccount[]
  initialAccount?: string | null
  pluginPolicy?: PluginSimulationPolicy
  apiPolicy?: ApiSimulationPolicy
  parseDebounceMs?: number
  className?: string
}

type SimulatorTab = 'preview' | 'data' | 'auth' | 'workflows' | 'plugins' | 'debug'

export function ZebricSimulator(props: ZebricSimulatorProps) {
  const {
    blueprint,
    blueprintToml,
    blueprintJson,
    seeds,
    initialSeed,
    accounts = defaultSimulatorAccounts,
    initialAccount,
    pluginPolicy = { defaultLevel: 1 },
    apiPolicy = { mode: 'debug' },
    parseDebounceMs = 200,
    className,
  } = props
  const runtimeRef = useRef<ZebricSimulatorRuntime | null>(null)
  const [tab, setTab] = useState<SimulatorTab>('preview')
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null)
  const [runtimeState, setRuntimeState] = useState<ZebricSimulatorState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const blueprintInputKey = useMemo(
    () => JSON.stringify({ blueprintHash: blueprint?.hash, blueprintToml, blueprintJson }),
    [blueprint, blueprintJson, blueprintToml]
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const existing = runtimeRef.current
        if (existing) {
          existing.setBlueprint({ blueprint, blueprintToml, blueprintJson })
        } else {
          runtimeRef.current = new ZebricSimulatorRuntime({
            blueprint,
            blueprintToml,
            blueprintJson,
            seeds,
            initialSeed,
            accounts,
            initialAccount,
            pluginPolicy,
            apiPolicy,
          })
        }
        void refresh()
        setError(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    }, parseDebounceMs)

    return () => window.clearTimeout(timeout)
  }, [blueprintInputKey, parseDebounceMs])

  async function refresh(path?: string) {
    const runtime = runtimeRef.current
    if (!runtime) return
    const result = await runtime.render(path)
    setRenderResult(result)
    setRuntimeState(runtime.getState())
  }

  async function submit(path: string, method: string, data: Record<string, any>) {
    const runtime = runtimeRef.current
    if (!runtime) return
    const result = await runtime.submit(path, method, data)
    setRenderResult(result)
    setRuntimeState(runtime.getState())
  }

  function switchAccount(accountId: string) {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.switchAccount(accountId === '__anonymous__' ? null : accountId)
    void refresh()
  }

  function switchSeed(seedName: string) {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.switchSeed(seedName)
    void refresh()
  }

  function resetSeed() {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.resetSeed()
    void refresh()
  }

  async function triggerWorkflow(workflowName: string) {
    const runtime = runtimeRef.current
    if (!runtime) return
    const result = await runtime.triggerWorkflow(workflowName, { source: 'react-simulator' })
    setRenderResult(result)
    setRuntimeState(runtime.getState())
  }

  return (
    <div className={['zebric-simulator', className].filter(Boolean).join(' ')}>
      <div className="zebric-simulator__toolbar">
        <label>
          Account
          <select
            value={runtimeState?.activeAccount?.id ?? '__anonymous__'}
            onChange={(event) => switchAccount(event.target.value)}
          >
            <option value="__anonymous__">Anonymous</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.role})
              </option>
            ))}
          </select>
        </label>

        <label>
          Seed
          <select
            value={runtimeState?.activeSeed ?? initialSeed ?? ''}
            onChange={(event) => switchSeed(event.target.value)}
          >
            {Object.keys(seeds || { empty: {} }).map((seedName) => (
              <option key={seedName} value={seedName}>
                {seedName}
              </option>
            ))}
          </select>
        </label>

        <button type="button" onClick={resetSeed}>
          Reset seed
        </button>
      </div>

      <div className="zebric-simulator__tabs" role="tablist" aria-label="Simulator tabs">
        {(['preview', 'data', 'auth', 'workflows', 'plugins', 'debug'] as SimulatorTab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? 'is-active' : ''}
            onClick={() => setTab(item)}
          >
            {formatTab(item)}
          </button>
        ))}
      </div>

      {error ? <pre className="zebric-simulator__error">{error}</pre> : null}

      <div className="zebric-simulator__panel">
        {tab === 'preview' ? (
          <PreviewPanel
            html={extractPreviewHtml(renderResult?.html || '')}
            onNavigate={(path) => refresh(path)}
            onSubmit={submit}
          />
        ) : null}
        {tab === 'data' ? <JsonPanel value={runtimeState?.data ?? {}} /> : null}
        {tab === 'auth' ? <JsonPanel value={runtimeState?.activeAccount ?? null} /> : null}
        {tab === 'workflows' ? (
          <WorkflowPanel
            registered={runtimeState?.registeredWorkflows ?? []}
            history={runtimeState?.workflows ?? []}
            onTrigger={triggerWorkflow}
          />
        ) : null}
        {tab === 'plugins' ? (
          <JsonPanel value={{
            policy: pluginPolicy,
            calls: (runtimeState?.logs ?? []).filter((entry) => entry.type === 'plugin'),
          }} />
        ) : null}
        {tab === 'debug' ? <JsonPanel value={runtimeState?.logs ?? []} /> : null}
      </div>
    </div>
  )
}

function PreviewPanel(props: {
  html: string
  onNavigate: (path: string) => void
  onSubmit: (path: string, method: string, data: Record<string, any>) => void
}) {
  const { html, onNavigate, onSubmit } = props
  const ref = useRef<HTMLDivElement | null>(null)

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const button = (event.target as Element).closest('button')
    const deleteAction = button?.getAttribute('data-zebric-delete-action')
    const deleteRedirect = button?.getAttribute('data-zebric-delete-redirect')
    if (deleteAction) {
      event.preventDefault()
      onSubmit(deleteAction, 'DELETE', deleteRedirect ? { redirect: deleteRedirect } : {})
      return
    }

    const anchor = (event.target as Element).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#') || anchor.getAttribute('target') === '_blank') {
      return
    }
    event.preventDefault()
    onNavigate(href)
  }

  function handleSubmit(event: React.FormEvent<HTMLDivElement>) {
    const form = (event.target as Element).closest('form')
    if (!form) return
    event.preventDefault()
    const data = Object.fromEntries(new FormData(form as HTMLFormElement).entries())
    const action = form.getAttribute('action') || '/'
    const method = form.getAttribute('method') || 'POST'
    onSubmit(action, method, data)
  }

  return (
    <div
      ref={ref}
      className="zebric-simulator__preview"
      onClick={handleClick}
      onSubmit={handleSubmit}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function JsonPanel({ value }: { value: unknown }) {
  return <pre className="zebric-simulator__json">{JSON.stringify(value, null, 2)}</pre>
}

function WorkflowPanel(props: {
  registered: Array<{ name: string; trigger: unknown; stepCount: number; steps: string[] }>
  history: unknown[]
  onTrigger: (workflowName: string) => void
}) {
  const { registered, history, onTrigger } = props
  const [selected, setSelected] = useState('')

  useEffect(() => {
    if (!selected && registered[0]?.name) {
      setSelected(registered[0].name)
    }
  }, [registered, selected])

  return (
    <div className="zebric-simulator__workflow-panel">
      <div className="zebric-simulator__workflow-controls">
        <label>
          Workflow
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {registered.map((workflow) => (
              <option key={workflow.name} value={workflow.name}>
                {workflow.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!selected} onClick={() => onTrigger(selected)}>
          Trigger
        </button>
      </div>
      <JsonPanel value={{ registered, history }} />
    </div>
  )
}

function extractPreviewHtml(html: string): string {
  if (!html) return ''
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script').forEach((script) => script.remove())
    doc.querySelectorAll('*').forEach((element) => {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.toLowerCase().startsWith('on')) {
          if (attribute.name.toLowerCase() === 'onclick' && element.tagName === 'BUTTON') {
            const fetchMatch = attribute.value.match(/fetch\('([^']+)'[^)]*method:\s*'DELETE'/)
            const redirectMatch = attribute.value.match(/window\.location\.href='([^']+)'/)
            if (fetchMatch?.[1]) {
              element.setAttribute('data-zebric-delete-action', fetchMatch[1])
            }
            if (redirectMatch?.[1]) {
              element.setAttribute('data-zebric-delete-redirect', redirectMatch[1])
            }
          }
          element.removeAttribute(attribute.name)
        }
      }
    })

    const styles = Array.from(doc.head.querySelectorAll('style'))
      .map((style) => style.outerHTML)
      .join('')
    const bodyClass = doc.body.getAttribute('class') || ''
    return `${styles}<div class="${escapeHtmlAttr(bodyClass)}">${doc.body.innerHTML}</div>`
  }
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+="[^"]*"/gi, '')
}

function formatTab(tab: SimulatorTab): string {
  return tab.charAt(0).toUpperCase() + tab.slice(1)
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
