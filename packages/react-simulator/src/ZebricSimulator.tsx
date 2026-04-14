import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ZebricSimulatorRuntime,
  defaultSimulatorAccounts,
  type ApiSimulationPolicy,
  type PluginSimulationPolicy,
  type RenderResult,
  type SimulatorAccount,
  type SimulatorLogEntry,
  type SimulatorSeeds,
  type WorkflowStateEntry,
  type WorkflowSummary,
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
      <StatusBar state={runtimeState} renderResult={renderResult} error={error} />

      <div className="zebric-simulator__panel">
        {tab === 'preview' ? (
          <PreviewPanel
            html={extractPreviewHtml(renderResult?.html || '')}
            onNavigate={(path) => refresh(path)}
            onSubmit={submit}
          />
        ) : null}
        {tab === 'data' ? <DataPanel data={runtimeState?.data ?? {}} /> : null}
        {tab === 'auth' ? <AuthPanel state={runtimeState} /> : null}
        {tab === 'workflows' ? (
          <WorkflowPanel
            registered={runtimeState?.registeredWorkflows ?? []}
            history={runtimeState?.workflows ?? []}
            onTrigger={triggerWorkflow}
          />
        ) : null}
        {tab === 'plugins' ? (
          <PluginPanel
            policy={pluginPolicy}
            calls={(runtimeState?.logs ?? []).filter((entry) => entry.type === 'plugin')}
          />
        ) : null}
        {tab === 'debug' ? <DebugPanel logs={runtimeState?.logs ?? []} /> : null}
      </div>
    </div>
  )
}

function StatusBar(props: {
  state: ZebricSimulatorState | null
  renderResult: RenderResult | null
  error: string | null
}) {
  const { state, renderResult, error } = props
  return (
    <div className="zebric-simulator__statusbar">
      <StatusPill label="Route" value={state?.activePath || renderResult?.path || 'Not rendered'} />
      <StatusPill label="Status" value={error ? 'Error' : String(renderResult?.status ?? 'Pending')} tone={error ? 'error' : undefined} />
      <StatusPill label="Account" value={state?.activeAccount ? `${state.activeAccount.name} (${state.activeAccount.role})` : 'Anonymous'} />
      <StatusPill label="Seed" value={state?.activeSeed || 'none'} />
      <StatusPill label="Logs" value={String(state?.logs.length ?? 0)} />
    </div>
  )
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone?: 'error' }) {
  return (
    <span className={['zebric-simulator__pill', tone === 'error' ? 'is-error' : ''].filter(Boolean).join(' ')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
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

function DataPanel({ data }: { data: SimulatorSeeds[string] }) {
  const entities = Object.entries(data)
  if (entities.length === 0) {
    return <EmptyPanel title="No data loaded" detail="The active seed does not include records." />
  }

  return (
    <div className="zebric-simulator__stack">
      {entities.map(([entityName, rows]) => (
        <section key={entityName} className="zebric-simulator__section">
          <div className="zebric-simulator__section-header">
            <h3>{entityName}</h3>
            <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          </div>
          {rows.length > 0 ? <RecordTable rows={rows} /> : <EmptyPanel title="Empty entity" detail="No rows for this entity in the active seed." compact />}
        </section>
      ))}
    </div>
  )
}

function RecordTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8)
  return (
    <div className="zebric-simulator__table-wrap">
      <table className="zebric-simulator__table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AuthPanel({ state }: { state: ZebricSimulatorState | null }) {
  return (
    <div className="zebric-simulator__stack">
      <section className="zebric-simulator__section">
        <div className="zebric-simulator__section-header">
          <h3>Current session</h3>
        </div>
        {state?.activeAccount ? (
          <dl className="zebric-simulator__details">
            <dt>ID</dt><dd>{state.activeAccount.id}</dd>
            <dt>Name</dt><dd>{state.activeAccount.name}</dd>
            <dt>Email</dt><dd>{state.activeAccount.email}</dd>
            <dt>Role</dt><dd>{state.activeAccount.role}</dd>
          </dl>
        ) : <EmptyPanel title="Anonymous" detail="The simulator is rendering without an active account." compact />}
      </section>

      <section className="zebric-simulator__section">
        <div className="zebric-simulator__section-header">
          <h3>Available accounts</h3>
          <span>{state?.accounts.length ?? 0} account{state?.accounts.length === 1 ? '' : 's'}</span>
        </div>
        <RecordTable rows={state?.accounts ?? []} />
      </section>
    </div>
  )
}

function WorkflowPanel(props: {
  registered: WorkflowSummary[]
  history: WorkflowStateEntry[]
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
      <div className="zebric-simulator__stack">
        <section className="zebric-simulator__section">
          <div className="zebric-simulator__section-header">
            <h3>Registered workflows</h3>
            <span>{registered.length} total</span>
          </div>
          {registered.length > 0 ? (
            <div className="zebric-simulator__cards">
              {registered.map((workflow) => (
                <article key={workflow.name} className="zebric-simulator__card">
                  <h4>{workflow.name}</h4>
                  <p>{workflow.stepCount} step{workflow.stepCount === 1 ? '' : 's'}</p>
                  <code>{workflow.steps.join(' -> ') || 'No steps'}</code>
                </article>
              ))}
            </div>
          ) : <EmptyPanel title="No workflows" detail="This blueprint does not define workflows." compact />}
        </section>

        <section className="zebric-simulator__section">
          <div className="zebric-simulator__section-header">
            <h3>Trigger history</h3>
            <span>{history.length} event{history.length === 1 ? '' : 's'}</span>
          </div>
          {history.length > 0 ? <LogList logs={history.map(workflowToLogEntry)} /> : <EmptyPanel title="No workflow events" detail="Trigger a workflow to see simulator state here." compact />}
        </section>
      </div>
    </div>
  )
}

function PluginPanel({ policy, calls }: { policy: PluginSimulationPolicy; calls: SimulatorLogEntry[] }) {
  return (
    <div className="zebric-simulator__stack">
      <section className="zebric-simulator__section">
        <div className="zebric-simulator__section-header">
          <h3>Plugin policy</h3>
          <span>Level {policy.defaultLevel}</span>
        </div>
        <dl className="zebric-simulator__details">
          <dt>Default</dt><dd>Level {policy.defaultLevel}</dd>
          <dt>Overrides</dt><dd>{Object.keys(policy.perPlugin || {}).length || 'None'}</dd>
        </dl>
      </section>

      <section className="zebric-simulator__section">
        <div className="zebric-simulator__section-header">
          <h3>Plugin calls</h3>
          <span>{calls.length} call{calls.length === 1 ? '' : 's'}</span>
        </div>
        {calls.length > 0 ? <LogList logs={calls} /> : <EmptyPanel title="No plugin calls" detail="Level 1 plugin calls will appear here and in the Debug tab." compact />}
      </section>
    </div>
  )
}

function DebugPanel({ logs }: { logs: SimulatorLogEntry[] }) {
  return logs.length > 0 ? <LogList logs={logs} /> : <EmptyPanel title="No debug events" detail="Navigation, queries, mutations, workflows, and simulated API calls will appear here." />
}

function LogList({ logs }: { logs: SimulatorLogEntry[] }) {
  return (
    <ol className="zebric-simulator__logs">
      {logs.map((log) => (
        <li key={log.id}>
          <div>
            <span className="zebric-simulator__log-type">{log.type}</span>
            <strong>{log.message}</strong>
            <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
          </div>
          {log.detail !== undefined ? <pre>{JSON.stringify(log.detail, null, 2)}</pre> : null}
        </li>
      ))}
    </ol>
  )
}

function EmptyPanel({ title, detail, compact }: { title: string; detail: string; compact?: boolean }) {
  return (
    <div className={compact ? 'zebric-simulator__empty is-compact' : 'zebric-simulator__empty'}>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

function workflowToLogEntry(workflow: WorkflowStateEntry): SimulatorLogEntry {
  return {
    id: workflow.id,
    timestamp: workflow.timestamp,
    type: 'workflow',
    message: `${workflow.workflowName} ${workflow.status}`,
    detail: {
      payload: workflow.payload,
      logs: workflow.logs,
    },
  }
}

function formatCell(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
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
