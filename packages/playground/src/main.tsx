import React from 'react'
import { createRoot } from 'react-dom/client'
import { ZebricSimulator } from '@zebric/react-simulator'
import { BlueprintParser } from '@zebric/runtime-core'
import type { WorkflowStep, WorkflowTrigger } from '@zebric/runtime-core'
import '@zebric/react-simulator/styles.css'
import './styles.css'
import { examples, type PlaygroundExample } from './playground-examples'

type Route =
  | { name: 'examples' }
  | { name: 'example'; slug: string }
  | { name: 'about' }
  | { name: 'getting-started' }
  | { name: 'not-found' }

type BlueprintTab = 'raw' | 'structured'

const parser = new BlueprintParser()

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
  const [blueprintTab, setBlueprintTab] = React.useState<BlueprintTab>('raw')

  if (!example) {
    return <NotFoundPage onNavigate={onNavigate} />
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
        <div className="simulator-column">
          <ZebricSimulator
            blueprintToml={example.blueprintToml}
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
          <Panel title="What this demonstrates">
            <ul className="plain-list">
              {example.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Try this">
            <ol className="try-list">
              {example.trySteps.map((step) => (
                <li key={step}>{step}</li>
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
          </div>
          <div className="tab-buttons" role="tablist" aria-label="Blueprint view">
            <button
              type="button"
              className={blueprintTab === 'raw' ? 'is-active' : ''}
              onClick={() => setBlueprintTab('raw')}
            >
              Raw
            </button>
            <button
              type="button"
              className={blueprintTab === 'structured' ? 'is-active' : ''}
              onClick={() => setBlueprintTab('structured')}
            >
              Structured
            </button>
          </div>
        </div>
        {blueprintTab === 'raw' ? (
          <pre className="code-view" aria-label="Raw blueprint TOML">
            <code>
              <HighlightedToml source={example.blueprintToml} />
            </code>
          </pre>
        ) : (
          <StructuredBlueprint example={example} />
        )}
      </section>
    </main>
  )
}

function HighlightedToml({ source }: { source: string }) {
  const lines = source.split('\n')

  return (
    <>
      {lines.map((line, index) => (
        <React.Fragment key={`${index}-${line}`}>
          {highlightTomlLine(line)}
          {index < lines.length - 1 ? '\n' : null}
        </React.Fragment>
      ))}
    </>
  )
}

function highlightTomlLine(line: string) {
  const trimmed = line.trim()
  if (trimmed.startsWith('#')) return <span className="toml-comment">{line}</span>
  if (trimmed.startsWith('[')) return <span className="toml-section">{line}</span>

  const equalsIndex = line.indexOf('=')
  if (equalsIndex === -1) return line

  const key = line.slice(0, equalsIndex)
  const value = line.slice(equalsIndex + 1)

  return (
    <>
      <span className="toml-key">{key}</span>
      <span className="toml-punctuation">=</span>
      {highlightTomlValue(value)}
    </>
  )
}

function highlightTomlValue(value: string) {
  const parts = value.split(/("[^"]*"|\btrue\b|\bfalse\b|\b\d+(?:\.\d+)?\b)/g)
  return parts.map((part, index) => {
    if (!part) return null
    if (part.startsWith('"') && part.endsWith('"')) {
      return (
        <span key={`${part}-${index}`} className="toml-string">
          {part}
        </span>
      )
    }
    if (part === 'true' || part === 'false') {
      return (
        <span key={`${part}-${index}`} className="toml-boolean">
          {part}
        </span>
      )
    }
    if (/^\d/.test(part)) {
      return (
        <span key={`${part}-${index}`} className="toml-number">
          {part}
        </span>
      )
    }
    return part
  })
}

function StructuredBlueprint({ example }: { example: PlaygroundExample }) {
  const parsed = React.useMemo(() => {
    try {
      return { blueprint: parser.parse(example.blueprintToml, 'toml', `${example.slug}.toml`) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [example])

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
