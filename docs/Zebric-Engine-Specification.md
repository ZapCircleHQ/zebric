## 3. Core Runtime Systems

### 3.1 Server-Side HTML Renderer

The engine renders complete HTML pages on the server - no React, no build step, no hydration.

```typescript
// packages/runtime/src/renderer/html-renderer.ts

export class HTMLRenderer {
  constructor(
    private blueprint: Blueprint,
    private theme: Theme,
    private plugins: PluginRegistry
  ) {}
  
  async renderPage(
    page: Page,
    data: any,
    session: Session | null,
    request: FastifyRequest
  ): Promise<string> {
    // Render layout based on type
    const content = this.renderLayout(page, data, session)
    
    // Wrap in document shell
    return this.wrapInDocument(content, {
      title: page.title,
      theme: this.theme,
      viewTransitions: this.blueprint.ui?.view_transitions !== false,
      enhancement: this.blueprint.ui?.progressive_enhancement || 'none'
    })
  }
  
  private renderLayout(page: Page, data: any, session: Session | null): string {
    switch (page.layout) {
      case 'list':
        return this.renderListLayout(page, data)
      case 'detail':
        return this.renderDetailLayout(page, data)
      case 'form':
        return this.renderFormLayout(page, data)
      default:
        // Custom layout from plugin
        const renderer = this.plugins.getLayoutRenderer(page.layout)
        if (renderer) {
          return renderer(page, data, this.theme, session)
        }
        throw new Error(`Unknown layout: ${page.layout}`)
    }
  }
  
  private renderListLayout(page: Page, data: any): string {
    const queryName = Object.keys(page.queries || {})[0]
    const items = data[queryName] || []
    const entity = this.getEntity(page.queries![queryName].entity)
    
    return html`
      <div class="${this.theme.container}">
        <header class="${this.theme.pageHeader}">
          <h1 class="${this.theme.heading1}">${page.title}</h1>
          ${this.renderActions(page, entity)}
        </header>
        
        ${items.length === 0 
          ? html`<div class="${this.theme.emptyState}">No ${entity.name.toLowerCase()}s found</div>`
          : this.renderTable(items, entity)
        }
      </div>
    `
  }
  
  private renderTable(items: any[], entity: Entity): string {
    const fields = this.getDisplayFields(items[0], entity)
    
    return html`
      <div class="${this.theme.card}">
        <table class="${this.theme.table}">
          <thead>
            <tr>
              ${fields.map(f => html`
                <th class="${this.theme.tableHeader}">
                  ${this.formatFieldName(f.name)}
                </th>
              `).join('')}
              <th class="${this.theme.tableHeader}">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => html`
              <tr class="${this.theme.tableRow}">
                ${fields.map(f => html`
                  <td class="${this.theme.tableCell}">
                    ${this.formatValue(item[f.name], f.type)}
                  </td>
                `).join('')}
                <td class="${this.theme.tableCell} ${this.theme.tableActions}">
                  <a href="/${entity.name.toLowerCase()}/${item.id}" 
                     class="${this.theme.linkPrimary}">
                    View
                  </a>
                  <a href="/${entity.name.toLowerCase()}/${item.id}/edit" 
                     class="${this.theme.linkSecondary}">
                    Edit
                  </a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }
  
  private renderFormLayout(page: Page, data: any): string {
    const form = page.form!
    const record = data?.record
    
    return html`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <h1 class="${this.theme.heading1}">${page.title}</h1>
        
        <form 
          method="POST" 
          action="${page.path}"
          class="${this.theme.form}"
          data-enhance="${this.blueprint.ui?.progressive_enhancement || 'none'}"
        >
          ${form.fields.map(field => this.renderField(field, record)).join('')}
          
          <div class="${this.theme.formActions}">
            <button 
              type="button"
              onclick="history.back()"
              class="${this.theme.buttonSecondary}"
            >
              Cancel
            </button>
            <button 
              type="submit"
              class="${this.theme.buttonPrimary}"
            >
              ${form.method === 'create' ? 'Create' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    `
  }
  
  private renderField(field: FormField, record?: any): string {
    const value = record?.[field.name] || field.default || ''
    
    return html`
      <div class="${this.theme.formField}">
        <label for="${field.name}" class="${this.theme.label}">
          ${field.label || this.formatFieldName(field.name)}
          ${field.required ? html`<span class="text-red-500">*</span>` : ''}
        </label>
        
        ${this.renderInput(field, value)}
        
        ${field.error_message ? html`
          <p class="${this.theme.fieldError}" data-error="${field.name}">
            ${field.error_message}
          </p>
        ` : ''}
      </div>
    `
  }
  
  private renderInput(field: FormField, value: any): string {
    switch (field.type) {
      case 'text':
      case 'email':
      case 'url':
        return html`
          <input 
            type="${field.type}"
            id="${field.name}"
            name="${field.name}"
            value="${value}"
            placeholder="${field.placeholder || ''}"
            ${field.required ? 'required' : ''}
            ${field.pattern ? `pattern="${field.pattern}"` : ''}
            class="${this.theme.input}"
          />
        `
      
      case 'textarea':
        return html`
          <textarea
            id="${field.name}"
            name="${field.name}"
            rows="${field.rows || 4}"
            placeholder="${field.placeholder || ''}"
            ${field.required ? 'required' : ''}
            class="${this.theme.textarea}"
          >${value}</textarea>
        `
      
      case 'select':
        return html`
          <select
            id="${field.name}"
            name="${field.name}"
            ${field.required ? 'required' : ''}
            class="${this.theme.select}"
          >
            ${field.options?.map(opt => html`
              <option value="${opt}" ${value === opt ? 'selected' : ''}>
                ${opt}
              </option>
            `).join('')}
          </select>
        `
      
      case 'file':
        return html`
          <input
            type="file"
            id="${field.name}"
            name="${field.name}"
            accept="${field.accept?.join(',') || ''}"
            ${field.required ? 'required' : ''}
            class="${this.theme.fileInput}"
          />
        `
      
      default:
        return html`<input type="text" name="${field.name}" value="${value}" class="${this.theme.input}" />`
    }
  }
  
  private wrapInDocument(content: string, options: DocumentOptions): string {
    return html`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${options.title}</title>
          
          <!-- Tailwind CDN (or precompiled in production) -->
          <script src="https://cdn.tailwindcss.com"></script>
          ${options.theme.customCSS ? html`<style>${options.theme.customCSS}</style>` : ''}
          
          <!-- View Transitions API -->
          ${options.viewTransitions ? html`
            <meta name="view-transition" content="same-origin">
            <style>
              @view-transition {
                navigation: auto;
              }
              
              /* Smooth page transitions */
              ::view-transition-old(root),
              ::view-transition-new(root) {
                animation-duration: 0.2s;
                animation-timing-function: ease-in-out;
              }
              
              /* Fade transition */
              ::view-transition-old(root) {
                animation-name: fade-out;
              }
              ::view-transition-new(root) {
                animation-name: fade-in;
              }
              
              @keyframes fade-out {
                to { opacity: 0; }
              }
              @keyframes fade-in {
                from { opacity: 0; }
              }
            </style>
          ` : ''}
          
          <!-- Progressive Enhancement -->
          ${this.renderEnhancementScripts(options.enhancement)}
        </head>
        <body class="${options.theme.body}">
          ${this.renderNav(options.theme)}
          
          <main>
            ${content}
          </main>
          
          ${this.renderFooter(options.theme)}
          
          <!-- Minimal client-side enhancement -->
          ${this.renderClientScript(options)}
        </body>
      </html>
    `
  }
  
  private renderEnhancementScripts(enhancement: string): string {
    switch (enhancement) {
      case 'alpine':
        return html`
          <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
        `
      case 'htmx':
        return html`
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        `
      default:
        return ''
    }
  }
  
  private renderClientScript(options: DocumentOptions): string {
    // Minimal progressive enhancement for forms and navigation
    return html`
      <script>
        // Form handling with optimistic UI
        document.querySelectorAll('form[data-enhance]').forEach(form => {
          if (form.dataset.enhance === 'none') return
          
          form.addEventListener('submit', async (e) => {
            e.preventDefault()
            
            const submitBtn = form.querySelector('button[type="submit"]')
            const originalText = submitBtn.textContent
            submitBtn.textContent = 'Saving...'
            submitBtn.disabled = true
            
            try {
              const formData = new FormData(form)
              const response = await fetch(form.action, {
                method: 'POST',
                body: formData
              })
              
              if (response.ok) {
                const result = await response.json()
                
                // Navigate with View Transition if available
                if (result.redirect) {
                  if (document.startViewTransition) {
                    document.startViewTransition(() => {
                      window.location.href = result.redirect
                    })
                  } else {
                    window.location.href = result.redirect
                  }
                }
              } else {
                const error = await response.json()
                
                // Show errors
                if (error.errors) {
                  error.errors.forEach(err => {
                    const errorEl = document.querySelector(\`[data-error="\${err.field}"]\`)
                    if (errorEl) {
                      errorEl.textContent = err.message
                      errorEl.classList.remove('hidden')
                    }
                  })
                } else {
                  alert(error.message || 'An error occurred')
                }
                
                submitBtn.textContent = originalText
                submitBtn.disabled = false
              }
            } catch (error) {
              console.error(error)
              alert('An error occurred. Please try again.')
              submitBtn.textContent = originalText
              submitBtn.disabled = false
            }
          })
        })
        
        // Enhanced navigation with View Transitions
        ${options.viewTransitions ? html`
          document.querySelectorAll('a[href^="/"]').forEach(link => {
            link.addEventListener('click', (e) => {
              // Skip external links and anchors
              if (link.hostname !== location.hostname || link.hash) return
              
              if (document.startViewTransition) {
                e.preventDefault()
                document.startViewTransition(() => {
                  window.location.href = link.href
                })
              }
            })
          })
        ` : ''}
        
        // Speculation Rules API for prefetching
        if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
          const specScript = document.createElement('script')
          specScript.type = 'speculationrules'
          specScript.textContent = JSON.stringify({
            prerender: [
              {
                where: { href_matches: '/*' },
                eagerness: 'moderate'
              }
            ]
          })
          document.body.appendChild(specScript)
        }
      </script>
    `
  }
  
  private renderNav(theme: Theme): string {
    // TODO: Get nav items from Blueprint
    return html`
      <nav class="${theme.nav}">
        <div class="${theme.container}">
          <div class="${theme.navContent}">
            <a href="/" class="${theme.navBrand}">
              ${this.blueprint.project.name}
            </a>
            <div class="${theme.navLinks}">
              <!-- Navigation items from Blueprint -->
            </div>
          </div>
        </div>
      </nav>
    `
  }
}

// Tagged template for safe HTML
function html(strings: TemplateStringsArray, ...values: any[]): string {
  let result = strings[0]
  for (let i = 0; i < values.length; i++) {
    result += escapeHtml(String(values[i])) + strings[i + 1]
  }
  return result
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
```

### 3.2 Theme System

```typescript
// packages/runtime/src/renderer/theme.ts

export interface Theme {
  name: string
  
  // Layout
  body: string
  container: string
  containerNarrow: string
  
  // Typography
  heading1: string
  heading2: string
  heading3: string
  textPrimary: string
  textSecondary: string
  
  // Navigation
  nav: string
  navContent: string
  navBrand: string
  navLinks: string
  navLink: string
  
  // Components
  card: string
  button Primary: string
  buttonSecondary: string
  linkPrimary: string
  linkSecondary: string
  
  // Tables
  table: string
  tableHeader: string
  tableRow: string
  tableCell: string
  tableActions: string
  
  // Forms
  form: string
  formField: string
  formActions: string
  label: string
  input: string
  textarea: string
  select: string
  fileInput: string
  fieldError: string
  
  // States
  emptyState: string
  loadingState: string
  errorState: string
  
  // Page-specific
  pageHeader: string
  
  // Custom CSS (optional)
  customCSS?: string
}

// Built-in default theme
export const defaultTheme: Theme = {
  name: 'default',
  
  // Layout
  body: 'bg-gray-50 text-gray-900 min-h-screen',
  container: 'container mx-auto px-4 py-8',
  containerNarrow: 'max-w-2xl',
  
  // Typography
  heading1: 'text-3xl font-bold text-gray-900 mb-6',
  heading2: 'text-2xl font-semibold text-gray-800 mb-4',
  heading3: 'text-xl font-medium text-gray-700 mb-3',
  textPrimary: 'text-gray-900',
  textSecondary: 'text-gray-600',
  
  // Navigation
  nav: 'bg-white shadow',
  navContent: 'flex justify-between items-center h-16',
  navBrand: 'text-xl font-bold text-gray-900',
  navLinks: 'flex space-x-6',
  navLink: 'text-gray-600 hover:text-gray-900 transition-colors',
  
  // Components
  card: 'bg-white rounded-lg shadow overflow-hidden',
  buttonPrimary: 'px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors',
  buttonSecondary: 'px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors',
  linkPrimary: 'text-blue-600 hover:text-blue-800 transition-colors',
  linkSecondary: 'text-gray-600 hover:text-gray-800 transition-colors',
  
  // Tables
  table: 'min-w-full divide-y divide-gray-200',
  tableHeader: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50',
  tableRow: 'hover:bg-gray-50 transition-colors',
  tableCell: 'px-6 py-4 whitespace-nowrap text-sm text-gray-900',
  tableActions: 'space-x-3',
  
  // Forms
  form: 'bg-white rounded-lg shadow p-6 space-y-6',
  formField: 'space-y-2',
  formActions: 'flex justify-end gap-3 pt-6',
  label: 'block text-sm font-medium text-gray-700',
  input: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow',
  textarea: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow resize-y',
  select: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow',
  fileInput: 'w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100',
  fieldError: 'text-sm text-red-600 mt-1 hidden',
  
  // States
  emptyState: 'text-center py-12 text-gray-500',
  loadingState: 'text-center py-12 text-gray-500 animate-pulse',
  errorState: 'text-center py-12 text-red-600',
  
  // Page-specific
  pageHeader: 'flex justify-between items-center mb-6'
}
```

### 3.3 Progressive Enhancement Options

**Option 1: Pure Server (Default)**
```toml
[ui]
render_mode = "server"
progressive_enhancement = "none"
```
- Zero client JavaScript (except minimal form handling)
- View Transitions API for smooth navigation
- Perfect for content-heavy sites

**Option 2: Alpine.js Enhancement**
```toml
[ui]
render_mode = "server"
progressive_enhancement = "alpine"
```
- Server renders HTML
- Alpine.js adds interactivity (dropdowns, modals, etc.)
- ~15KB JavaScript

**Option 3: HTMX Enhancement**
```toml
[ui]
render_mode = "server"
progressive_enhancement = "htmx"
```
- Server renders HTML
- HTMX for dynamic content loading
- ~14KB JavaScript

**Option 4: React (Plugin, Opt-In)**
```toml
[plugin."@zebric/ui-react"]
enabled = true

[page."/dashboard"]
renderer = "plugin:@zebric/ui-react"  # Only this page uses React
component = "./components/Dashboard.tsx"
```
- Full React SPA for specific pages
- Requires custom component
- User explicitly opts in

### 3.4 Engine Bootstrap

```typescript
// packages/runtime/src/engine.ts

export class ZebricEngine {
  private blueprint: Blueprint
  private db: DrizzleDB
  private plugins: PluginRegistry
  private renderer: HTMLRenderer
  private server: FastifyInstance
  private watcher: FSWatcher | null = null
  
  constructor(private config: EngineConfig) {}
  
  async start() {
    console.log('🚀 Starting Zebric Runtime Engine...')
    
    // 1. Load Blueprint
    this.blueprint = await this.loadBlueprint(this.config.blueprintPath)
    console.log(`✅ Loaded Blueprint: ${this.blueprint.project.name}`)
    
    // 2. Initialize Database
    this.db = await this.initDatabase()
    await this.runMigrations()
    console.log('✅ Database initialized')
    
    // 3. Load Plugins
    this.plugins = await this.loadPlugins()
    console.log(`✅ Loaded ${this.plugins.count()} plugins`)
    
    // 4. Initialize HTML Renderer
    const theme = await this.loadTheme(this.blueprint.ui?.theme || 'default')
    this.renderer = new HTMLRenderer(this.blueprint, theme, this.plugins)
    console.log('✅ Renderer initialized')
    
    // 5. Start HTTP Server
    this.server = await this.createServer()
    await this.server.listen({ 
      port: this.config.port || 3000,
      host: '0.0.0.0'
    })
    console.log(`✅ Server running at http://localhost:${this.config.port || 3000}`)
    
    // 6. Watch for Blueprint changes (if in dev mode)
    if (this.config.dev?.hotReload) {
      this.watcher = this.watchBlueprint()
      console.log('👀 Watching for Blueprint changes...')
    }
  }
  
  private async createServer(): Promise<FastifyInstance> {
    const app = Fastify({ logger: true })
    
    // Register plugins
    await app.register(require('@fastify/formbody'))
    await app.register(require('@fastify/cookie'))
    await app.register(require('@fastify/static'), {
      root: path.join(__dirname, '../public'),
      prefix: '/public/'
    })
    
    // Register routes from Blueprint
    for (const page of this.blueprint.pages) {
      this.registerPageRoute(app, page)
    }
    
    // Register API routes (auto-generated CRUD)
    for (const entity of this.blueprint.entities) {
      this.registerEntityRoutes(app, entity)
    }
    
    // Admin UI
    if (this.config.dev) {
      this.registerAdminRoutes(app)
    }
    
    return app
  }
  
  private registerPageRoute(app: FastifyInstance, page: Page) {
    // GET route - render page
    app.get(page.path, async (request, reply) => {
      // 1. Check auth
      const session = await this.getSession(request)
      if (page.auth === 'required' && !session) {
        return reply.redirect('/login')
      }
      
      // 2. Execute queries
      const data = {}
      for (const [name, queryDef] of Object.entries(page.queries || {})) {
        data[name] = await this.executeQuery(queryDef, session, request.params)
      }
      
      // 3. Render HTML
      const html = await this.renderer.renderPage(page, data, session, request)
      
      return reply.type('text/html').send(html)
    })
    
    // POST route - handle form submission
    if (page.form) {
      app.post(page.path, async (request, reply) => {
        const session = await this.getSession(request)
        
        try {
          const result = await this.handleFormSubmission(
            page.form,
            request.body,
            session
          )
          
          // Return JSON for AJAX, redirect for regular forms
          if (request.headers.accept?.includes('application/json')) {
            return reply.send(result)
          } else {
            return reply.redirect(
              page.form.onSuccess?.redirect?.replace('{id}', result.id) || '/'
            )
          }
        } catch (error) {
          if (error instanceof ValidationError) {
            return reply.code(400).send({
              success: false,
              errors: error.errors
            })
          }
          throw error
        }
      })
    }
  }
}
```

---

## 4. Plugin System Implementation

### 4.1 Plugin Registry

```typescript
// packages/runtime/src/plugins/registry.ts

export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>()
  
  async load(pluginDef: PluginDefinition, engine: EngineAPI) {
    console.log(`Loading plugin: ${pluginDef.name}`)
    
    // 1. Resolve plugin (from npm, local, or git)
    const pluginModule = await this.resolvePlugin(pluginDef)
    
    // 2. Initialize plugin
    const plugin = await pluginModule.default
    await plugin.init?.(engine, pluginDef.config)
    
    // 3. Register plugin
    this.plugins.set(pluginDef.name, {
      definition: pluginDef,
      module: pluginModule,
      plugin
    })
    
    console.log(`✅ Plugin loaded: ${pluginDef.name}`)
  }
  
  private async resolvePlugin(def: PluginDefinition): Promise<any> {
    // NPM package
    if (def.name.startsWith('@') || !def.name.startsWith('.')) {
      return await import(def.name)
    }
    
    // Local path
    if (def.name.startsWith('./') || def.name.startsWith('../')) {
      const fullPath = path.resolve(process.cwd(), def.name)
      return await import(fullPath)
    }
    
    throw new Error(`Unknown plugin source: ${def.name}`)
  }
  
  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name)
  }
  
  getWorkflowAction(pluginName: string, actionName: string) {
    const plugin = this.get(pluginName)
    if (!plugin) throw new Error(`Plugin ${pluginName} not found`)
    
    const action = plugin.plugin.workflows?.[actionName]
    if (!action) {
      throw new Error(`Action ${actionName} not found in plugin ${pluginName}`)
    }
    
    return action
  }
  
  getComponent(pluginName: string, componentName: string) {
    const plugin = this.get(pluginName)
    if (!plugin) throw new Error(`Plugin ${pluginName} not found`)
    
    const component = plugin.plugin.components?.[componentName]
    if (!component) {
      throw new Error(`Component ${componentName} not found in plugin ${pluginName}`)
    }
    
    return component
  }
}
```

### 4.2 Plugin SDK

```typescript
// packages/plugin-sdk/src/index.ts

export function definePlugin(config: PluginConfig): Plugin {
  return {
    name: config.name,
    version: config.version,
    provides: config.provides,
    requires: config.requires,
    
    async init(engine, pluginConfig) {
      await config.init?.(engine, pluginConfig)
    },
    
    workflows: config.workflows || {},
    components: config.components || {},
    integrations: config.integrations || {},
    middleware: config.middleware || {}
  }
}

// Engine API exposed to plugins
export interface EngineAPI {
  // Database access (read-only schema, full query access)
  db: DrizzleDB
  
  // Auth
  auth: {
    getCurrentUser(request: Request): Promise<User | null>
    createSession(userId: string): Promise<Session>
    invalidateSession(sessionId: string): Promise<void>
  }
  
  // Storage
  storage: {
    upload(key: string, data: Buffer, options?: UploadOptions): Promise<string>
    download(key: string): Promise<Buffer>
    delete(key: string): Promise<void>
    getUrl(key: string): string
  }
  
  // Cache
  cache: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: any, ttl?: number): Promise<void>
    delete(key: string): Promise<void>
  }
  
  // Workflows
  workflows: {
    trigger(name: string, context: any): Promise<void>
  }
  
  // Events
  on(event: string, handler: Function): void
  emit(event: string, data: any): void
  
  // Blueprint (read-only)
  blueprint: Readonly<Blueprint>
  
  // Logging
  log: Logger
}
```

### 4.3 Example Plugin

```typescript
// plugins/custom-notifications/index.ts

import { definePlugin } from '@zebric/plugin-sdk'
import { Slack } from '@slack/web-api'

export default definePlugin({
  name: 'custom-notifications',
  version: '1.0.0',
  
  provides: {
    workflows: ['send-slack', 'send-teams'],
  },
  
  requires: {
    cache: true,
    db: true
  },
  
  async init(engine, config) {
    // Initialize Slack client
    this.slack = new Slack(config.slackToken)
    
    // Subscribe to engine events
    engine.on('user.created', async (user) => {
      await this.slack.chat.postMessage({
        channel: config.channel,
        text: `New user: ${user.email}`
      })
    })
  },
  
  workflows: {
    'send-slack': async (params, context) => {
      // Access engine APIs
      const user = await context.db.query.users.findFirst({
        where: eq(users.id, params.userId)
      })
      
      // Send Slack message
      await this.slack.chat.postMessage({
        channel: params.channel,
        text: `${params.message}\nUser: ${user.email}`
      })
      
      // Log
      context.log.info({ userId: params.userId }, 'Slack notification sent')
    },
    
    'send-teams': async (params, context) => {
      // Microsoft Teams webhook
      await fetch(params.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: params.message })
      })
    }
  }
})
```

---

## 5. Hot Reload System

### 5.1 Blueprint Watcher

```typescript
// packages/runtime/src/hot-reload/watcher.ts

export class BlueprintWatcher {
  private watcher: FSWatcher | null = null
  
  watch(path: string, onReload: (blueprint: Blueprint) => void) {
    this.watcher = chokidar.watch(path, {
      persistent: true,
      ignoreInitial: true
    })
    
    this.watcher.on('change', async () => {
      console.log('📝 Blueprint changed, reloading...')
      
      try {
        const content = await fs.readFile(path, 'utf-8')
        const blueprint = JSON.parse(content)
        
        // Validate
        const result = BlueprintSchema.safeParse(blueprint)
        if (!result.success) {
          console.error('❌ Invalid Blueprint:', result.error)
          return
        }
        
        // Trigger reload
        await onReload(result.data)
        console.log('✅ Reload complete')
      } catch (error) {
        console.error('❌ Failed to reload:', error)
      }
    })
  }
  
  stop() {
    this.watcher?.close()
  }
}
```

### 5.2 Hot Reload Handler

```typescript
// packages/runtime/src/hot-reload/handler.ts

export class HotReloadHandler {
  async reload(engine: ZebricEngine, newBlueprint: Blueprint) {
    const oldBlueprint = engine.getBlueprint()
    
    // 1. Run migrations (if schema changed)
    if (this.schemaChanged(oldBlueprint, newBlueprint)) {
      await this.runMigrations(oldBlueprint, newBlueprint)
    }
    
    // 2. Reload plugins (if plugin config changed)
    if (this.pluginsChanged(oldBlueprint, newBlueprint)) {
      await this.reloadPlugins(newBlueprint)
    }
    
    // 3. Update in-memory blueprint
    engine.setBlueprint(newBlueprint)
    
    // 4. Clear route cache
    engine.clearRouteCache()
    
    // 5. Notify clients (via WebSocket)
    engine.emit('blueprint:reload', { 
      timestamp: new Date(),
      changes: this.diff(oldBlueprint, newBlueprint)
    })
    
    // Existing connections continue working with new Blueprint!
  }
  
  private schemaChanged(old: Blueprint, new: Blueprint): boolean {
    return JSON.stringify(old.entities) !== JSON.stringify(new.entities)
  }
  
  private pluginsChanged(old: Blueprint, new: Blueprint): boolean {
    return JSON.stringify(old.plugins) !== JSON.stringify(new.plugins)
  }
}
```

---

## 6. Performance & Caching

### 6.1 Route Caching

```typescript
// packages/runtime/src/performance/route-cache.ts

export class RouteCache {
  private cache = new LRU<string, CompiledRoute>({
    max: 1000,
    ttl: 1000 * 60 * 5 // 5 minutes
  })
  
  getOrCompile(path: string, blueprint: Blueprint): CompiledRoute {
    const cached = this.cache.get(path)
    if (cached) return cached
    
    // Compile route at runtime
    const page = this.matchRoute(path, blueprint.pages)
    const compiled = this.compileRoute(page)
    
    this.cache.set(path, compiled)
    return compiled
  }
  
  private compileRoute(page: Page): CompiledRoute {
    // Pre-compile where clauses, etc for faster execution
    return {
      page,
      queries: this.compileQueries(page.queries),
      permissions: this.compilePermissions(page)
    }
  }
  
  clear() {
    this.cache.clear()
  }
}
```

### 6.2 Query Caching

```typescript
// packages/runtime/src/performance/query-cache.ts

export class QueryCache {
  constructor(private redis: Redis) {}
  
  async get(key: string): Promise<any | null> {
    const cached = await this.redis.get(key)
    return cached ? JSON.parse(cached) : null
  }
  
  async set(key: string, value: any, ttl: number = 300) {
    await this.redis.setex(key, ttl, JSON.stringify(value))
  }
  
  async invalidate(pattern: string) {
    const keys = await this.redis.keys(pattern)
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }
  
  // Invalidate on entity changes
  async invalidateEntity(entityName: string) {
    await this.invalidate(`query:${entityName}:*`)
  }
}
```

### 6.3 Performance Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| Cold start | < 1s | Lazy load plugins, cache compiled routes |
| Hot reload | < 500ms | In-memory blueprint swap, minimal disruption |
| Route lookup | < 1ms | LRU cache of compiled routes |
| Query execution | < 50ms | Drizzle's optimized SQL + query cache |
| Form submission | < 100ms | Validation cache, batch workflows |

---

## 7. Development Experience

### 7.1 CLI - Dev Command

```typescript
// packages/cli/src/commands/dev.ts

export async function devCommand(options: DevOptions) {
  console.log('🚀 Starting Zebric Development Server...\n')
  
  // 1. Find blueprint
  const blueprintPath = await findBlueprint(process.cwd())
  if (!blueprintPath) {
    console.error('❌ No blueprint.json found')
    process.exit(1)
  }
  
  // 2. Create engine
  const engine = new ZebricEngine({
    blueprintPath,
    port: options.port || 3000,
    dev: {
      hotReload: true,
      seed: options.seed,
      logLevel: 'debug'
    }
  })
  
  // 3. Start engine
  await engine.start()
  
  console.log('\n✅ Ready!\n')
  console.log(`📱 App:      http://localhost:${options.port}`)
  console.log(`📊 Admin:    http://localhost:${options.port}/__admin`)
  console.log(`📝 Docs:     http://localhost:${options.port}/__docs`)
  console.log(`🔍 Explorer: http://localhost:${options.port}/__explorer\n`)
  
  // 4. Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down...')
    await engine.stop()
    process.exit(0)
  })
}
```

### 7.2 Admin UI (Built-in)

```typescript
// packages/runtime/src/server/admin-routes.ts

export function registerAdminRoutes(app: FastifyInstance, engine: ZebricEngine) {
  // Blueprint viewer
  app.get('/__admin/blueprint', async (req, reply) => {
    return reply.send(engine.getBlueprint())
  })
  
  // Entity explorer
  app.get('/__admin/entities', async (req, reply) => {
    const entities = engine.getBlueprint().entities.map(e => ({
      name: e.name,
      fields: e.fields,
      recordCount: await engine.db.select({ count: count() })
        .from(engine.getTable(e.name))
    }))
    return reply.send(entities)
  })
  
  // Plugin inspector
  app.get('/__admin/plugins', async (req, reply) => {
    return reply.send(engine.plugins.list().map(p => ({
      name: p.definition.name,
      version: p.definition.version,
      provides: p.plugin.provides,
      enabled: p.definition.enabled
    })))
  })
  
  // Workflow inspector
  app.get('/__admin/workflows', async (req, reply) => {
    const workflows = engine.getBlueprint().workflows
    const jobs = await engine.queue.getJobs(['active', 'waiting', 'completed', 'failed'])
    
    return reply.send({
      workflows,
      jobs: jobs.map(j => ({
        id: j.id,
        name: j.name,
        status: await j.getState(),
        progress: j.progress,
        data: j.data
      }))
    })
  })
  
  // Performance metrics
  app.get('/__admin/metrics', async (req, reply) => {
    return reply.send({
      routeCache: {
        size: engine.routeCache.size,
        hitRate: engine.routeCache.hitRate
      },
      queryCache: {
        hitRate: await engine.queryCache.getHitRate()
      },
      memory: process.memoryUsage(),
      uptime: process.uptime()
    })
  })
}
```

---

## 8. Deployment

### 8.1 Build Process (Minimal)

```bash
# No code generation - just package Blueprint + Engine + Plugins

zebric deploy --provider=cloudflare

# Creates:
.zebric/deploy/
├── blueprint.json          # The app
├── plugins/               # Installed plugins
│   ├── @mycompany/
│   └── node_modules/
└── .env.production        # Env vars
```

The engine runtime is deployed as:
- **Cloudflare**: Worker script
- **Vercel**: Edge function
- **Railway**: Docker container

No generated code files!

### 8.2 Dockerfile (for Railway/Fly.io)

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install Zebric engine
RUN npm install -g @zebric/engine-node

# Copy application
COPY blueprint.json ./
COPY plugins/ ./plugins/
COPY .env.production ./.env

# Expose port
EXPOSE 3000

# Run engine
CMD ["Zebric-engine", "--blueprint=blueprint.json", "--port=3000"]
```

### 8.3 Cloudflare Worker (Engine as Worker)

```typescript
// Generated worker.ts (minimal wrapper)

import { ZebricEngine } from '@zebric/engine-node/cloudflare'
import blueprint from './blueprint.json'

const engine = new ZebricEngine({
  blueprint,
  database: env.DB,  // D1
  storage: env.BUCKET,  // R2
  queue: env.QUEUE
})

export default {
  async fetch(request: Request, env: Env) {
    return engine.handleRequest(request)
  },
  
  async queue(batch: MessageBatch, env: Env) {
    return engine.handleQueue(batch)
  }
}
```
