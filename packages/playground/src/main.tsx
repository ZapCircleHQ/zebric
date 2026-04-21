import React from 'react'
import { createRoot } from 'react-dom/client'
import { ZebricSimulator } from '@zebric/react-simulator'
import { BlueprintParser } from '@zebric/runtime-core'
import type { Blueprint, WorkflowStep, WorkflowTrigger } from '@zebric/runtime-core'
import '@zebric/react-simulator/styles.css'
import './styles.css'
import { examples, type PlaygroundDocLink, type PlaygroundExample } from './playground-examples'

type Route =
  | { name: 'examples' }
  | { name: 'example'; slug: string }
  | { name: 'about' }
  | { name: 'getting-started' }
  | { name: 'not-found' }

type BlueprintTab = 'editor' | 'structured' | 'validation' | 'diff'
type DemoTarget = 'simulator' | 'editor' | 'structured' | 'validation'

interface ParsedBlueprintDraft {
  blueprint?: Blueprint
  error: string | null
}

const parser = new BlueprintParser()
const docsLinks = {
  blueprint: 'https://docs.zebric.dev/building/blueprint/',
  workflows: 'https://docs.zebric.dev/building/workflows/',
  runtime: 'https://docs.zebric.dev/run/runtime/',
  quickstart: 'https://docs.zebric.dev/getting-started/quick-start/',
  security: 'https://docs.zebric.dev/building/security/',
  api: 'https://docs.zebric.dev/reference/api/',
}

function App() {
  const [path, setPath] = React.useState(window.location.pathname)

  React.useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const route = resolveRoute(path)

  function navigate(to: string) {
    window.history.pushState({}, '', to)
    setPath(to)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="site-shell">
      <Header path={path} onNavigate={navigate} />
      {route.name === 'examples' ? <ExamplesPage onNavigate={navigate} /> : null}
      {route.name === 'example' ? (
        <ExampleDetailPage slug={route.slug} onNavigate={navigate} />
      ) : null}
      {route.name === 'about' ? <AboutSimulatorPage /> : null}
      {route.name === 'getting-started' ? <GettingStartedPage onNavigate={navigate} /> : null}
      {route.name === 'not-found' ? <NotFoundPage onNavigate={navigate} /> : null}
      <Footer onNavigate={navigate} />
    </div>
  )
}

function resolveRoute(path: string): Route {
  if (path === '/') return { name: 'examples' }
  if (path === '/examples') return { name: 'examples' }
  if (path === '/about-simulator') return { name: 'about' }
  if (path === '/getting-started') return { name: 'getting-started' }
  const match = path.match(/^\/examples\/([^/]+)$/)
  if (match?.[1]) return { name: 'example', slug: match[1] }
  return { name: 'not-found' }
}

function Header({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  return (
    <header className="topbar">
      <a href="/" className="brand" onClick={(event) => handleLink(event, '/', onNavigate)}>
        <span className="brand-mark">Z</span>
        <span>Zebric Playground</span>
      </a>
      <nav aria-label="Primary navigation">
        <NavLink href="/" path={path} onNavigate={onNavigate}>
          Playground
        </NavLink>
        <NavLink href="/about-simulator" path={path} onNavigate={onNavigate}>
          Simulator
        </NavLink>
        <NavLink href="/getting-started" path={path} onNavigate={onNavigate}>
          Getting Started
        </NavLink>
      </nav>
    </header>
  )
}

function NavLink({
  href,
  path,
  children,
  onNavigate,
}: {
  href: string
  path: string
  children: React.ReactNode
  onNavigate: (path: string) => void
}) {
  return (
    <a
      href={href}
      aria-current={path === href ? 'page' : undefined}
      onClick={(event) => handleLink(event, href, onNavigate)}
    >
      {children}
    </a>
  )
}

function ExamplesPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const tags = Array.from(new Set(examples.flatMap((example) => example.tags))).sort()
  const [selectedTag, setSelectedTag] = React.useState('all')
  const visibleExamples =
    selectedTag === 'all'
      ? examples
      : examples.filter((example) => example.tags.includes(selectedTag))

  return (
    <main className="page-main">
      <PageIntro
        eyebrow="Running in Zebric Simulator"
        title="Zebric Playground"
        copy="Choose an example, switch roles, reset scenarios, and inspect the blueprint behind the app."
      />
      <DocsStrip
        links={[
          { label: 'What is Zebric?', href: 'https://docs.zebric.dev/getting-started/what-is-zebric/' },
          { label: 'Quick start', href: docsLinks.quickstart },
          { label: 'Blueprint guide', href: docsLinks.blueprint },
        ]}
      />
      <div className="tag-filter" aria-label="Filter examples by tag">
        <button
          type="button"
          className={selectedTag === 'all' ? 'is-active' : ''}
          onClick={() => setSelectedTag('all')}
        >
          All
        </button>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={selectedTag === tag ? 'is-active' : ''}
            onClick={() => setSelectedTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      <ExampleGrid examples={visibleExamples} onNavigate={onNavigate} />
    </main>
  )
}

function ExampleDetailPage({
  slug,
  onNavigate,
}: {
  slug: string
  onNavigate: (path: string) => void
}) {
  const example = examples.find((candidate) => candidate.slug === slug)
  const [blueprintTab, setBlueprintTab] = React.useState<BlueprintTab>('editor')
  const [blueprintDraft, setBlueprintDraft] = React.useState(
    () => examples.find((candidate) => candidate.slug === slug)?.blueprintToml || ''
  )
  const [copyStatus, setCopyStatus] = React.useState('')
  const [demoMode, setDemoMode] = React.useState(false)
  const [demoStepIndex, setDemoStepIndex] = React.useState(0)
  const originalBlueprint = example?.blueprintToml || ''

  React.useEffect(() => {
    setBlueprintDraft(originalBlueprint)
    setBlueprintTab('editor')
    setCopyStatus('')
    setDemoMode(false)
    setDemoStepIndex(0)
  }, [originalBlueprint])

  const parsedDraft = React.useMemo<ParsedBlueprintDraft>(() => {
    if (!blueprintDraft) return { error: null }

    try {
      return { blueprint: parser.parse(blueprintDraft, 'toml', `${slug}.toml`), error: null }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [blueprintDraft, slug])
  const validationReport = React.useMemo(
    () => createValidationReport(parsedDraft, blueprintDraft),
    [blueprintDraft, parsedDraft]
  )

  if (!example) {
    return <NotFoundPage onNavigate={onNavigate} />
  }

  const hasDraftChanges = blueprintDraft !== originalBlueprint
  const downloadSlug = example.slug
  const demoSteps = example.trySteps
  const demoTarget = demoMode ? inferDemoTarget(demoSteps[demoStepIndex] || '') : null

  async function copyBlueprint() {
    if (!navigator.clipboard) {
      setCopyStatus('Clipboard unavailable')
      return
    }

    await navigator.clipboard.writeText(blueprintDraft)
    setCopyStatus('Copied')
    window.setTimeout(() => setCopyStatus(''), 1600)
  }

  function downloadBlueprint() {
    const blob = new Blob([blueprintDraft], { type: 'application/toml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${downloadSlug}.toml`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function setDemoStep(nextIndex: number) {
    const boundedIndex = Math.max(0, Math.min(nextIndex, demoSteps.length - 1))
    setDemoStepIndex(boundedIndex)
    focusDemoTarget(demoSteps[boundedIndex] || '')
  }

  function startDemo() {
    setDemoMode(true)
    setDemoStep(0)
  }

  function stopDemo() {
    setDemoMode(false)
    setDemoStepIndex(0)
  }

  function focusDemoTarget(step: string) {
    const target = inferDemoTarget(step)
    if (target === 'editor') setBlueprintTab('editor')
    if (target === 'structured') setBlueprintTab('structured')
    if (target === 'validation') setBlueprintTab('validation')
  }

  return (
    <main className="example-page">
      <a
        className="back-link"
        href="/"
        onClick={(event) => handleLink(event, '/', onNavigate)}
      >
        Back to playground
      </a>
      <section className="example-header">
        <div>
          <p className="eyebrow">Running in Zebric Simulator</p>
          <h1>{example.title}</h1>
          <p>{example.description}</p>
        </div>
        <div className="example-links">
          <a href={example.githubUrl}>View on GitHub</a>
          <a href={example.runLocallyUrl}>Run locally</a>
          {example.docsUrls.map((doc) => (
            <a key={doc.href} href={doc.href}>
              {doc.label}
            </a>
          ))}
        </div>
      </section>

      <section className="detail-layout">
        <div className={['simulator-column', demoTarget === 'simulator' ? 'is-demo-focus' : ''].filter(Boolean).join(' ')}>
          <ZebricSimulator
            blueprintToml={blueprintDraft}
            seeds={example.seeds}
            initialSeed={example.defaultScenario}
            accounts={example.accounts}
            initialAccount={example.defaultRole}
            pluginPolicy={{ defaultLevel: 1 }}
            apiPolicy={{ mode: 'debug' }}
            className="playground-simulator"
          />
        </div>
        <aside className="example-sidebar">
          <DemoModePanel
            steps={example.trySteps}
            isActive={demoMode}
            currentIndex={demoStepIndex}
            onStart={startDemo}
            onStop={stopDemo}
            onNext={() => setDemoStep(demoStepIndex + 1)}
            onPrevious={() => setDemoStep(demoStepIndex - 1)}
          />
          <Panel title="What this demonstrates">
            <ul className="plain-list">
              {example.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Try this">
            <ol className="try-list">
              {example.trySteps.map((step, index) => (
                <li
                  key={step}
                  className={demoMode && index === demoStepIndex ? 'is-active' : ''}
                >
                  {step}
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Scenarios">
            <ul className="plain-list">
              {example.scenarios.map((scenario) => (
                <li key={scenario.name}>
                  <strong>{scenario.label}</strong>
                  <span>{scenario.description}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Notes">
            <p>{example.notes}</p>
          </Panel>
        </aside>
      </section>

      <section className="blueprint-viewer">
        <div className="viewer-header">
          <div>
            <p className="eyebrow">Blueprint viewer</p>
            <h2>{example.title} blueprint</h2>
            <p className="viewer-subtitle">Edits run locally in the simulator. Reset restores the bundled example.</p>
            <DocsStrip
              links={[
                { label: 'Blueprint docs', href: docsLinks.blueprint },
                { label: 'Runtime docs', href: docsLinks.runtime },
              ]}
            />
          </div>
          <div className="viewer-actions">
            <div className="tab-buttons" role="tablist" aria-label="Blueprint view">
              <button
                type="button"
                className={blueprintTab === 'editor' ? 'is-active' : ''}
                onClick={() => setBlueprintTab('editor')}
              >
                Editor
              </button>
              <button
                type="button"
                className={blueprintTab === 'structured' ? 'is-active' : ''}
                onClick={() => setBlueprintTab('structured')}
              >
                Structured
              </button>
              <button
                type="button"
                className={blueprintTab === 'validation' ? 'is-active' : ''}
                onClick={() => setBlueprintTab('validation')}
              >
                Validation
              </button>
              <button
                type="button"
                className={blueprintTab === 'diff' ? 'is-active' : ''}
                onClick={() => setBlueprintTab('diff')}
              >
                Diff
              </button>
            </div>
            <div className="blueprint-editor-actions">
              <span className={parsedDraft.error ? 'is-error' : 'is-valid'}>
                {parsedDraft.error ? 'Parse error' : 'Valid blueprint'}
              </span>
              {hasDraftChanges ? <span>Edited</span> : null}
              <button type="button" onClick={() => setBlueprintDraft(originalBlueprint)}>
                Reset
              </button>
              <button type="button" onClick={copyBlueprint}>
                {copyStatus || 'Copy'}
              </button>
              <button type="button" onClick={downloadBlueprint}>
                Download
              </button>
            </div>
          </div>
        </div>
        {blueprintTab === 'editor' ? (
          <div className="editor-shell">
            <BlueprintCodeEditor
              value={blueprintDraft}
              onChange={setBlueprintDraft}
              hasError={Boolean(parsedDraft.error)}
            />
            {parsedDraft.error ? <pre className="editor-error">{parsedDraft.error}</pre> : null}
          </div>
        ) : null}
        {blueprintTab === 'structured' ? (
          <StructuredBlueprint example={example} blueprintToml={blueprintDraft} />
        ) : null}
        {blueprintTab === 'validation' ? (
          <ValidationPanel report={validationReport} />
        ) : null}
        {blueprintTab === 'diff' ? (
          <BlueprintDiff original={originalBlueprint} draft={blueprintDraft} />
        ) : null}
      </section>
    </main>
  )
}

function DemoModePanel({
  steps,
  isActive,
  currentIndex,
  onStart,
  onStop,
  onNext,
  onPrevious,
}: {
  steps: string[]
  isActive: boolean
  currentIndex: number
  onStart: () => void
  onStop: () => void
  onNext: () => void
  onPrevious: () => void
}) {
  const currentStep = steps[currentIndex]
  const isLastStep = currentIndex >= steps.length - 1

  return (
    <section className="demo-panel">
      <div>
        <p className="eyebrow">Optional demo mode</p>
        <h2>Walk through this app</h2>
        <p>Follow the workflow without saving anything or leaving the browser.</p>
      </div>
      {isActive ? (
        <>
          <div className="demo-progress" aria-label="Demo progress">
            <span style={{ width: `${((currentIndex + 1) / steps.length) * 100}%` }} />
          </div>
          <div className="demo-current-step">
            <span>
              Step {currentIndex + 1} of {steps.length}
            </span>
            <strong>{currentStep}</strong>
          </div>
          <div className="demo-actions">
            <button type="button" onClick={onPrevious} disabled={currentIndex === 0}>
              Back
            </button>
            <button type="button" onClick={isLastStep ? onStop : onNext}>
              {isLastStep ? 'Finish' : 'Next'}
            </button>
            <button type="button" onClick={onStop}>
              Exit
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="demo-start" onClick={onStart}>
          Start Demo
        </button>
      )}
    </section>
  )
}

function inferDemoTarget(step: string): DemoTarget {
  const normalized = step.toLowerCase()
  if (normalized.includes('blueprint') || normalized.includes('edit')) return 'editor'
  if (normalized.includes('workflow') || normalized.includes('audit') || normalized.includes('inspect')) {
    return 'structured'
  }
  if (normalized.includes('valid') || normalized.includes('error')) return 'validation'
  return 'simulator'
}

function DocsStrip({ links }: { links: PlaygroundDocLink[] }) {
  return (
    <div className="docs-strip">
      {links.map((link) => (
        <a key={link.href} href={link.href}>
          {link.label}
        </a>
      ))}
    </div>
  )
}

function BlueprintCodeEditor({
  value,
  onChange,
  hasError,
}: {
  value: string
  onChange: (value: string) => void
  hasError: boolean
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const viewRef = React.useRef<{
    state: { doc: { toString(): string } }
    dispatch(update: { changes: { from: number; to: number; insert: string } }): void
    destroy(): void
  } | null>(null)
  const onChangeRef = React.useRef(onChange)

  React.useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  React.useEffect(() => {
    if (!hostRef.current) return
    let isMounted = true
    const parent = hostRef.current

    async function mountEditor() {
      const [{ HighlightStyle, StreamLanguage, syntaxHighlighting }, { tags }, { toml }, { basicSetup, EditorView }] = await Promise.all([
        import('@codemirror/language'),
        import('@lezer/highlight'),
        import('@codemirror/legacy-modes/mode/toml'),
        import('codemirror'),
      ])

      if (!isMounted) return

      const blueprintHighlightStyle = HighlightStyle.define([
        { tag: tags.heading, color: '#d6a642', fontWeight: '700' },
        { tag: tags.propertyName, color: '#acdfff' },
        { tag: [tags.string, tags.number, tags.bool, tags.atom], color: '#f4f7f8' },
        { tag: tags.comment, color: '#8fa0aa', fontStyle: 'italic' },
        { tag: tags.punctuation, color: '#c6d2d8' },
      ])
      const blueprintTomlMode = {
        ...toml,
        token(stream: any, state: any) {
          if (stream.sol() && !state.inString && state.inArray === 0) {
            state.lhs = true
          }

          if (
            state.lhs &&
            !state.inString &&
            state.inArray === 0 &&
            stream.peek() === '[' &&
            stream.skipTo(']')
          ) {
            stream.next()
            if (stream.peek() === ']') stream.next()
            return 'header'
          }

          return toml.token(stream, state)
        },
      }

      const view = new EditorView({
        doc: value,
        parent,
        extensions: [
          basicSetup,
          StreamLanguage.define(blueprintTomlMode),
          syntaxHighlighting(blueprintHighlightStyle),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      })

      viewRef.current = view
    }

    void mountEditor()

    return () => {
      isMounted = false
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentValue = view.state.doc.toString()
    if (currentValue === value) return

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
    })
  }, [value])

  return (
    <div
      ref={hostRef}
      className={['code-editor', hasError ? 'has-error' : ''].filter(Boolean).join(' ')}
      aria-label="Blueprint TOML editor"
    />
  )
}

function StructuredBlueprint({
  example,
  blueprintToml,
}: {
  example: PlaygroundExample
  blueprintToml: string
}) {
  const parsed = React.useMemo(() => {
    try {
      return { blueprint: parser.parse(blueprintToml, 'toml', `${example.slug}.toml`) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [blueprintToml, example.slug])

  if (parsed.error) {
    return <pre className="code-view error">{parsed.error}</pre>
  }

  const blueprint = parsed.blueprint
  if (!blueprint) return null

  const actionCount = blueprint.pages.reduce(
    (count, page) => count + (page.actionBar?.actions?.length || 0),
    0
  )
  const queryCount = blueprint.pages.reduce(
    (count, page) => count + Object.keys(page.queries || {}).length,
    0
  )
  const formCount = blueprint.pages.filter((page) => page.form).length
  const workflowStepCount = (blueprint.workflows || []).reduce(
    (count, workflow) => count + workflow.steps.length,
    0
  )
  const workflowStepTypes = Array.from(
    new Set((blueprint.workflows || []).flatMap((workflow) => workflow.steps.map((step) => step.type)))
  )
  const primaryEntity = blueprint.entities.reduce(
    (largest, entity) => (entity.fields.length > largest.fields.length ? entity : largest),
    blueprint.entities[0]
  )
  const automationSignals = [
    ...(blueprint.workflows?.length ? ['workflows'] : []),
    ...(blueprint.plugins?.length ? ['plugins'] : []),
    ...(blueprint.notifications?.adapters?.length ? ['notifications'] : []),
    ...workflowStepTypes,
  ]

  const summaryCards = [
    {
      title: 'Entities',
      value: blueprint.entities.length,
      detail: primaryEntity ? `${primaryEntity.name} carries the richest model` : 'No entities',
    },
    {
      title: 'Routes',
      value: blueprint.pages.length,
      detail: `${queryCount} queries, ${formCount} forms, ${actionCount} actions`,
    },
    {
      title: 'Workflows',
      value: blueprint.workflows?.length || 0,
      detail: `${workflowStepCount} simulated steps`,
    },
    {
      title: 'Roles',
      value: example.accounts.length,
      detail: example.accounts.map((account) => account.role).join(', '),
    },
  ]

  return (
    <div className="blueprint-map">
      <section className="blueprint-map__hero" aria-label="Blueprint summary">
        <div>
          <p className="eyebrow">Parsed blueprint</p>
          <h3>{blueprint.project.name}</h3>
          <p>{blueprint.project.description || example.description}</p>
          <DocsStrip
            links={[
              { label: 'Blueprint guide', href: docsLinks.blueprint },
              { label: 'API reference', href: docsLinks.api },
            ]}
          />
        </div>
        <div className="blueprint-map__badges" aria-label="Automation signals">
          {automationSignals.length ? (
            automationSignals.slice(0, 8).map((signal) => <span key={signal}>{signal}</span>)
          ) : (
            <span>static app</span>
          )}
        </div>
      </section>

      <section className="blueprint-stats" aria-label="Blueprint metrics">
        {summaryCards.map((card) => (
          <article key={card.title}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="blueprint-two-column">
        <article className="blueprint-panel blueprint-panel--large">
          <div className="blueprint-panel__header">
            <span>01</span>
            <h3>Data Model</h3>
          </div>
          <DocsStrip links={[{ label: 'Model blueprints', href: docsLinks.blueprint }]} />
          <div className="entity-map">
            {blueprint.entities.map((entity) => {
              const primaryFields = entity.fields.filter((field) => field.primary_key)
              const requiredFields = entity.fields.filter((field) => field.required)
              const relationshipFields = entity.fields.filter((field) => field.type === 'Ref')

              return (
                <section key={entity.name} className="entity-card">
                  <div className="entity-card__header">
                    <h4>{entity.name}</h4>
                    <span>{entity.fields.length} fields</span>
                  </div>
                  <div className="entity-card__meta">
                    <span>{primaryFields.length} primary</span>
                    <span>{requiredFields.length} required</span>
                    <span>{relationshipFields.length} refs</span>
                  </div>
                  <div className="field-cloud">
                    {entity.fields.map((field) => (
                      <span key={field.name} title={field.ref || field.type}>
                        <strong>{field.name}</strong>
                        {field.type}
                      </span>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </article>

        <article className="blueprint-panel">
          <div className="blueprint-panel__header">
            <span>02</span>
            <h3>Roles</h3>
          </div>
          <div className="role-stack">
            {example.accounts.map((account) => (
              <section key={account.id}>
                <strong>{account.name}</strong>
                <span>{account.role}</span>
                <small>{account.email}</small>
              </section>
            ))}
          </div>
        </article>
      </section>

      <section className="blueprint-panel">
        <div className="blueprint-panel__header">
          <span>03</span>
          <h3>Experience Routes</h3>
        </div>
        <DocsStrip links={[{ label: 'Pages and forms', href: docsLinks.blueprint }]} />
        <RouteFlow blueprint={blueprint} />
        <div className="route-map">
          {blueprint.pages.map((page) => (
            <section key={page.path} className="route-card">
              <div>
                <span className="route-path">{page.path}</span>
                <h4>{page.title}</h4>
              </div>
              <div className="route-tags">
                <span>{page.layout}</span>
                <span>{page.auth || 'none'}</span>
                {page.form ? <span>form</span> : null}
                {page.actionBar?.actions?.length ? <span>{page.actionBar.actions.length} actions</span> : null}
              </div>
              {page.queries ? (
                <dl className="query-list">
                  {Object.entries(page.queries).map(([queryName, query]) => (
                    <React.Fragment key={queryName}>
                      <dt>{queryName}</dt>
                      <dd>{query.entity}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : null}
              {page.form ? (
                <p className="route-note">
                  Creates {page.form.entity} with {page.form.fields.length} fields.
                </p>
              ) : null}
              {page.actionBar?.actions?.length ? (
                <div className="action-strip">
                  {page.actionBar.actions.map((action) => (
                    <span key={action.label}>{action.label}</span>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </section>

      <section className="blueprint-two-column">
        <article className="blueprint-panel blueprint-panel--large">
          <div className="blueprint-panel__header">
            <span>04</span>
            <h3>Workflow Trace</h3>
          </div>
          <DocsStrip links={[{ label: 'Workflow docs', href: docsLinks.workflows }]} />
          {blueprint.workflows?.length ? (
            <div className="workflow-map">
              {blueprint.workflows.map((workflow) => (
                <section key={workflow.name} className="workflow-card">
                  <div className="workflow-card__header">
                    <h4>{workflow.name}</h4>
                    <span>{formatTrigger(workflow.trigger)}</span>
                  </div>
                  <div className="workflow-steps">
                    {workflow.steps.map((step, index) => (
                      <span key={`${workflow.name}-${index}-${step.type}`}>
                        <strong>{index + 1}</strong>
                        {formatStep(step)}
                      </span>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p>No workflows are defined in this blueprint.</p>
          )}
        </article>

        <article className="blueprint-panel">
          <div className="blueprint-panel__header">
            <span>05</span>
            <h3>Integrations</h3>
          </div>
          <DocsStrip
            links={[
              { label: 'Runtime docs', href: docsLinks.runtime },
              { label: 'Security docs', href: docsLinks.security },
            ]}
          />
          <div className="integration-list">
            {(blueprint.plugins || []).map((plugin) => (
              <section key={plugin.name}>
                <strong>{plugin.name}</strong>
                <span>{plugin.enabled ? 'enabled' : 'disabled'}</span>
                <small>{plugin.trust_level || 'limited'} trust</small>
              </section>
            ))}
            {(blueprint.notifications?.adapters || []).map((adapter) => (
              <section key={adapter.name}>
                <strong>{adapter.name}</strong>
                <span>{adapter.type}</span>
                <small>notification adapter</small>
              </section>
            ))}
            {!blueprint.plugins?.length && !blueprint.notifications?.adapters?.length ? (
              <p>No plugins or notification adapters are configured.</p>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  )
}

function RouteFlow({ blueprint }: { blueprint: Blueprint }) {
  const routeEdges = blueprint.pages.flatMap((page) => {
    const formRedirect = page.form?.onSuccess?.redirect
    const actionEdges =
      page.actionBar?.actions
        ?.filter((action) => action.workflow)
        .map((action) => ({
          from: page.path,
          to: action.workflow || '',
          label: action.label,
          type: 'workflow' as const,
        })) || []

    return [
      ...(formRedirect
        ? [
            {
              from: page.path,
              to: normalizeRouteTarget(formRedirect),
              label: 'form success',
              type: 'route' as const,
            },
          ]
        : []),
      ...actionEdges,
    ]
  })

  const pagesWithActions = blueprint.pages.filter(
    (page) => page.form || page.actionBar?.actions?.length || page.queries
  )

  return (
    <section className="route-flow" aria-label="Route flow map">
      <div className="route-flow__rail">
        {pagesWithActions.map((page, index) => (
          <React.Fragment key={page.path}>
            <article>
              <span>{page.path}</span>
              <strong>{page.title}</strong>
              <small>{page.layout}</small>
            </article>
            {index < pagesWithActions.length - 1 ? <div className="route-flow__connector" /> : null}
          </React.Fragment>
        ))}
      </div>
      {routeEdges.length ? (
        <div className="route-flow__edges">
          {routeEdges.map((edge) => (
            <span key={`${edge.from}-${edge.to}-${edge.label}`} className={`is-${edge.type}`}>
              <strong>{edge.from}</strong>
              <em>{edge.label}</em>
              <strong>{edge.to}</strong>
            </span>
          ))}
        </div>
      ) : (
        <p>No redirects or workflow action edges are defined.</p>
      )}
    </section>
  )
}

function normalizeRouteTarget(target: string) {
  return target.replace(/\{[^}]+\}/g, ':id')
}

function slugifyEntityName(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase()
}

function pageTargetsEntity(page: Blueprint['pages'][number], entityName: string) {
  if (page.queries && Object.values(page.queries).some((query) => query.entity === entityName)) {
    return true
  }
  if (page.form?.entity === entityName) {
    return true
  }
  return false
}

function getEntityPagePath(
  blueprint: Blueprint,
  entityName: string,
  type: 'create' | 'detail' | 'update' | 'delete' | 'list'
) {
  switch (type) {
    case 'create':
      return (
        blueprint.pages.find((page) => page.form?.entity === entityName && page.form.method === 'create')
          ?.path || null
      )
    case 'update':
      return (
        blueprint.pages.find((page) => page.form?.entity === entityName && page.form.method === 'update')
          ?.path || null
      )
    case 'delete':
      return (
        blueprint.pages.find((page) => page.form?.entity === entityName && page.form.method === 'delete')
          ?.path || null
      )
    case 'detail':
      return (
        blueprint.pages.find((page) => page.layout === 'detail' && pageTargetsEntity(page, entityName))
          ?.path || null
      )
    case 'list': {
      const candidates = blueprint.pages.filter(
        (page) => page.layout === 'list' && pageTargetsEntity(page, entityName)
      )
      if (!candidates.length) return null
      const slug = slugifyEntityName(entityName)
      return (candidates.find((page) => page.path !== '/' && page.path.includes(slug)) || candidates[0]!)
        .path
    }
    default:
      return null
  }
}

interface ValidationCheck {
  title: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

interface ValidationReport {
  status: 'valid' | 'invalid'
  summary: string
  error?: string
  checks: ValidationCheck[]
}

function createValidationReport(parsed: ParsedBlueprintDraft, source: string): ValidationReport {
  const lineCount = source.split('\n').length

  if (parsed.error || !parsed.blueprint) {
    return {
      status: 'invalid',
      summary: 'The editor draft cannot be parsed into a runnable blueprint yet.',
      error: parsed.error || 'Blueprint is empty.',
      checks: [
        {
          title: 'Parser',
          status: 'fail',
          detail: extractErrorLocation(parsed.error) || 'Fix the TOML or schema error shown below.',
        },
        {
          title: 'Source',
          status: 'warn',
          detail: `${lineCount} lines checked before parsing stopped.`,
        },
      ],
    }
  }

  const blueprint = parsed.blueprint
  const checks: ValidationCheck[] = []
  const entityNames = new Set(blueprint.entities.map((entity) => entity.name))
  const workflowNames = new Set((blueprint.workflows || []).map((workflow) => workflow.name))
  const pagePaths = new Set(blueprint.pages.map((page) => page.path))
  const pagesWithoutData = blueprint.pages.filter(
    (page) => !page.queries && !page.form && !page.actionBar?.actions?.length
  )
  const formsWithoutRedirect = blueprint.pages.filter((page) => page.form && !page.form.onSuccess?.redirect)
  const missingWorkflowActions = blueprint.pages.flatMap((page) =>
    page.actionBar?.actions
      ?.filter((action) => action.workflow && !workflowNames.has(action.workflow))
      .map((action) => `${page.path}: ${action.label} -> ${action.workflow}`) || []
  )
  const missingQueryEntities = blueprint.pages.flatMap((page) =>
    Object.entries(page.queries || {})
      .filter(([, query]) => !entityNames.has(query.entity))
      .map(([queryName, query]) => `${page.path}.${queryName} -> ${query.entity}`)
  )
  const missingFormEntities = blueprint.pages
    .filter((page) => page.form && !entityNames.has(page.form.entity))
    .map((page) => `${page.path} -> ${page.form?.entity}`)
  const brokenRedirects = blueprint.pages
    .filter((page) => {
      const redirect = page.form?.onSuccess?.redirect
      return redirect && !pagePaths.has(normalizeRouteTarget(redirect))
    })
    .map((page) => `${page.path} -> ${page.form?.onSuccess?.redirect}`)
  const listPagesMissingCreate = blueprint.pages
    .filter((page) => page.layout === 'list')
    .flatMap((page) =>
      Array.from(
        new Set(
          Object.values(page.queries || {})
            .map((query) => query.entity)
            .filter((entityName) => entityNames.has(entityName))
        )
      )
        .filter((entityName) => !getEntityPagePath(blueprint, entityName, 'create'))
        .map((entityName) => `${page.path} -> missing create page for ${entityName}`)
    )
  const listPagesMissingDetail = blueprint.pages
    .filter((page) => page.layout === 'list')
    .flatMap((page) =>
      Array.from(
        new Set(
          Object.values(page.queries || {})
            .map((query) => query.entity)
            .filter((entityName) => entityNames.has(entityName))
        )
      )
        .filter((entityName) => !getEntityPagePath(blueprint, entityName, 'detail'))
        .map((entityName) => `${page.path} -> missing detail page for ${entityName}`)
    )
  const dashboardPagesMissingDetail = blueprint.pages
    .filter((page) => page.layout === 'dashboard')
    .flatMap((page) =>
      Object.entries(page.queries || {})
        .filter(([, query]) => entityNames.has(query.entity))
        .filter(([, query]) => !getEntityPagePath(blueprint, query.entity, 'detail'))
        .map(([queryName, query]) => `${page.path}.${queryName} -> missing detail page for ${query.entity}`)
    )
  const dashboardPagesMissingList = blueprint.pages
    .filter((page) => page.layout === 'dashboard')
    .flatMap((page) =>
      Object.entries(page.queries || {})
        .filter(([, query]) => entityNames.has(query.entity))
        .filter(([, query]) => !getEntityPagePath(blueprint, query.entity, 'list'))
        .map(([queryName, query]) => `${page.path}.${queryName} -> missing list page for ${query.entity}`)
    )
  const detailPagesMissingUpdate = blueprint.pages
    .filter((page) => page.layout === 'detail')
    .flatMap((page) =>
      Array.from(
        new Set(
          Object.values(page.queries || {})
            .map((query) => query.entity)
            .filter((entityName) => entityNames.has(entityName))
        )
      )
        .filter((entityName) => !getEntityPagePath(blueprint, entityName, 'update'))
        .map((entityName) => `${page.path} -> no update form page for ${entityName}`)
    )

  checks.push({
    title: 'Parser',
    status: 'pass',
    detail: `${lineCount} lines parsed successfully as TOML and validated against the blueprint schema.`,
  })
  checks.push({
    title: 'Project',
    status: blueprint.project.name && blueprint.project.runtime.min_version ? 'pass' : 'warn',
    detail: `${blueprint.project.name} targets runtime ${blueprint.project.runtime.min_version}.`,
  })
  checks.push({
    title: 'Entities',
    status: blueprint.entities.length ? 'pass' : 'fail',
    detail: `${blueprint.entities.length} entities and ${blueprint.entities.reduce((sum, entity) => sum + entity.fields.length, 0)} fields.`,
  })
  checks.push({
    title: 'Routes',
    status: blueprint.pages.length ? 'pass' : 'fail',
    detail: `${blueprint.pages.length} pages, ${pagesWithoutData.length} static-only pages.`,
  })
  checks.push({
    title: 'Query references',
    status: missingQueryEntities.length ? 'fail' : 'pass',
    detail: missingQueryEntities.length
      ? missingQueryEntities.join(', ')
      : 'Every route query points at a known entity.',
  })
  checks.push({
    title: 'Form references',
    status: missingFormEntities.length ? 'fail' : formsWithoutRedirect.length ? 'warn' : 'pass',
    detail: missingFormEntities.length
      ? missingFormEntities.join(', ')
      : formsWithoutRedirect.length
        ? `${formsWithoutRedirect.length} forms do not define a success redirect.`
        : 'Every form points at a known entity and has a success redirect.',
  })
  checks.push({
    title: 'Workflow references',
    status: missingWorkflowActions.length ? 'fail' : 'pass',
    detail: missingWorkflowActions.length
      ? missingWorkflowActions.join(', ')
      : 'Every action-bar workflow points at a defined workflow.',
  })
  checks.push({
    title: 'Route redirects',
    status: brokenRedirects.length ? 'warn' : 'pass',
    detail: brokenRedirects.length
      ? brokenRedirects.join(', ')
      : 'Form success redirects match known route shapes.',
  })
  checks.push({
    title: 'UI affordances',
    status:
      listPagesMissingCreate.length ||
      listPagesMissingDetail.length ||
      dashboardPagesMissingDetail.length ||
      dashboardPagesMissingList.length ||
      detailPagesMissingUpdate.length
        ? 'warn'
        : 'pass',
    detail:
      [
        ...listPagesMissingCreate,
        ...listPagesMissingDetail,
        ...dashboardPagesMissingDetail,
        ...dashboardPagesMissingList,
        ...detailPagesMissingUpdate,
      ].join(', ') ||
      'Route-backed create, detail, dashboard, and update affordances are explicitly defined.',
  })

  const hasFailures = checks.some((check) => check.status === 'fail')
  const hasWarnings = checks.some((check) => check.status === 'warn')

  return {
    status: hasFailures ? 'invalid' : 'valid',
    summary: hasFailures
      ? 'The blueprint parses, but a reference check found a blocking issue.'
      : hasWarnings
        ? 'The blueprint is runnable, with a few things worth reviewing.'
        : 'The blueprint is runnable and the local reference checks look clean.',
    checks,
  }
}

function extractErrorLocation(error?: string | null) {
  if (!error) return null
  const match = error.match(/line\s+(\d+).*column\s+(\d+)|(\d+):(\d+)/i)
  if (!match) return null
  const line = match[1] || match[3]
  const column = match[2] || match[4]
  return `Error near line ${line}, column ${column}.`
}

function ValidationPanel({ report }: { report: ValidationReport }) {
  return (
    <section className="validation-panel">
      <div className={`validation-hero is-${report.status}`}>
        <span>{report.status === 'valid' ? 'Ready' : 'Needs work'}</span>
        <h3>{report.summary}</h3>
        <DocsStrip
          links={[
            { label: 'Blueprint spec', href: docsLinks.blueprint },
            { label: 'Workflow docs', href: docsLinks.workflows },
          ]}
        />
      </div>
      {report.error ? <pre className="validation-error">{report.error}</pre> : null}
      <div className="validation-grid">
        {report.checks.map((check) => (
          <article key={check.title} className={`validation-card is-${check.status}`}>
            <span>{check.status}</span>
            <h4>{check.title}</h4>
            <p>{check.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

type DiffRow =
  | { type: 'same'; originalLine: number; draftLine: number; text: string }
  | { type: 'remove'; originalLine: number; draftLine: null; text: string }
  | { type: 'add'; originalLine: null; draftLine: number; text: string }

function BlueprintDiff({ original, draft }: { original: string; draft: string }) {
  const rows = React.useMemo(() => createLineDiff(original, draft), [original, draft])
  const changedRows = rows.filter((row) => row.type !== 'same').length

  return (
    <section className="diff-panel">
      <div className="diff-summary">
        <span>{changedRows ? `${changedRows} changed lines` : 'No changes'}</span>
        <p>Comparing the bundled blueprint with the current editor draft.</p>
      </div>
      <div className="diff-table" role="table" aria-label="Blueprint diff">
        {rows.map((row, index) => (
          <div key={`${index}-${row.type}-${row.text}`} className={`diff-row is-${row.type}`} role="row">
            <span role="cell">{row.originalLine ?? ''}</span>
            <span role="cell">{row.draftLine ?? ''}</span>
            <code role="cell">{row.text || ' '}</code>
          </div>
        ))}
      </div>
    </section>
  )
}

function createLineDiff(original: string, draft: string): DiffRow[] {
  const originalLines = original.split('\n')
  const draftLines = draft.split('\n')
  const table = Array.from({ length: originalLines.length + 1 }, () =>
    Array<number>(draftLines.length + 1).fill(0)
  )

  for (let i = originalLines.length - 1; i >= 0; i--) {
    for (let j = draftLines.length - 1; j >= 0; j--) {
      table[i][j] =
        originalLines[i] === draftLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let originalIndex = 0
  let draftIndex = 0

  while (originalIndex < originalLines.length && draftIndex < draftLines.length) {
    if (originalLines[originalIndex] === draftLines[draftIndex]) {
      rows.push({
        type: 'same',
        originalLine: originalIndex + 1,
        draftLine: draftIndex + 1,
        text: originalLines[originalIndex],
      })
      originalIndex++
      draftIndex++
    } else if (table[originalIndex + 1][draftIndex] >= table[originalIndex][draftIndex + 1]) {
      rows.push({
        type: 'remove',
        originalLine: originalIndex + 1,
        draftLine: null,
        text: originalLines[originalIndex],
      })
      originalIndex++
    } else {
      rows.push({
        type: 'add',
        originalLine: null,
        draftLine: draftIndex + 1,
        text: draftLines[draftIndex],
      })
      draftIndex++
    }
  }

  while (originalIndex < originalLines.length) {
    rows.push({
      type: 'remove',
      originalLine: originalIndex + 1,
      draftLine: null,
      text: originalLines[originalIndex],
    })
    originalIndex++
  }

  while (draftIndex < draftLines.length) {
    rows.push({
      type: 'add',
      originalLine: null,
      draftLine: draftIndex + 1,
      text: draftLines[draftIndex],
    })
    draftIndex++
  }

  return rows
}

function formatTrigger(trigger: WorkflowTrigger) {
  if (trigger.manual) return 'manual action'
  if (trigger.webhook) return `webhook ${trigger.webhook}`
  if (trigger.entity && trigger.event) return `${trigger.entity} ${trigger.event}`
  if (trigger.schedule) return `schedule ${trigger.schedule}`
  return 'runtime trigger'
}

function formatStep(step: WorkflowStep) {
  const type = String(step.type || 'step')
  if (step.plugin && step.action) return `${type}: ${step.plugin}.${step.action}`
  if (step.adapter) return `${type}: ${step.adapter}`
  if (step.entity && step.action) return `${type}: ${step.entity}.${step.action}`
  return type
}

function ExampleGrid({
  examples: visibleExamples,
  onNavigate,
}: {
  examples: PlaygroundExample[]
  onNavigate: (path: string) => void
}) {
  return (
    <div className="example-grid">
      {visibleExamples.map((example) => (
        <article key={example.slug} className="example-card">
          <div>
            <p className="eyebrow">{example.tags.slice(0, 2).join(' / ')}</p>
            <h3>{example.title}</h3>
            <p>{example.description}</p>
          </div>
          <ul className="feature-list">
            {example.features.slice(0, 3).map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <a
            href={`/examples/${example.slug}`}
            onClick={(event) => handleLink(event, `/examples/${example.slug}`, onNavigate)}
          >
            Open example
          </a>
        </article>
      ))}
    </div>
  )
}

function AboutSimulatorPage() {
  return (
    <main className="page-main">
      <PageIntro
        eyebrow="About simulator"
        title="A browser-only runtime for exploration."
        copy="The playground uses Zebric Simulator to render blueprints, hold records in memory, and capture workflow traces without calling external services."
      />
      <section className="info-grid">
        <Panel title="Services are mocked">
          <p>Email, Slack, plugin, webhook, and API effects are captured as simulator events.</p>
        </Panel>
        <Panel title="Data is temporary">
          <p>Records live in memory for the active scenario. Reset reloads the selected seed data.</p>
        </Panel>
        <Panel title="Roles are local">
          <p>Switching accounts changes the active simulator identity without authentication.</p>
        </Panel>
      </section>
    </main>
  )
}

function GettingStartedPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <main className="page-main">
      <PageIntro
        eyebrow="Getting started"
        title="Use the playground, then run Zebric locally."
        copy="Start with an example, inspect its blueprint, and follow the project docs when you are ready to build."
      />
      <section className="resource-list">
        <a href="/" onClick={(event) => handleLink(event, '/', onNavigate)}>
          Browse playground examples
        </a>
        <a href="https://github.com/zebric/zebric">GitHub repository</a>
        <a href="https://docs.zebric.dev/getting-started/quick-start/">Quickstart docs</a>
        <a href="https://docs.zebric.dev/building/blueprint/">Blueprint guide</a>
      </section>
    </main>
  )
}

function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <main className="page-main">
      <PageIntro
        eyebrow="Not found"
        title="That playground page is not available."
        copy="The example gallery has the current set of runnable Zebric apps."
      />
      <a href="/" className="button primary" onClick={(event) => handleLink(event, '/', onNavigate)}>
        Open Playground
      </a>
    </main>
  )
}

function PageIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <section className="page-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{copy}</p>
    </section>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Footer({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <footer className="site-footer">
      <span>Zebric Playground</span>
      <a href="/" onClick={(event) => handleLink(event, '/', onNavigate)}>
        Playground
      </a>
      <a href="https://docs.zebric.dev/">Docs</a>
      <a href="https://github.com/zebric/zebric">GitHub</a>
    </footer>
  )
}

function handleLink(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
  onNavigate: (path: string) => void
) {
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  ) {
    return
  }

  event.preventDefault()
  onNavigate(href)
}

createRoot(document.getElementById('root')!).render(<App />)
