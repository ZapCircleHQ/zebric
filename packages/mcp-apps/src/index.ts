import { McpAppsSchema, type McpAppView } from '@zebric/runtime-core'
import type { ConfigureZebricMcpServer } from '@zebric/mcp-server'
import { renderMcpApp } from './render.js'

export type { McpAppView } from '@zebric/runtime-core'
export { renderMcpApp } from './render.js'

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** Compose with any Zebric MCP transport using its configureServer option. */
export function createMcpAppsExtension(views: readonly McpAppView[]): ConfigureZebricMcpServer {
  // Validate and snapshot once; retained HTTP handlers must not observe caller mutations.
  const config = McpAppsSchema.parse(views)
  return (server, { tools }) => {
    // Check all bindings before changing the server. Disabled mutations never become available.
    for (const view of config) {
      if (!tools.has(view.operation)) {
        throw new Error(`MCP App "${view.name}" references unavailable operation "${view.operation}"; check discovery and allowedMutations`)
      }
    }
    for (const view of config) {
      const { name, registration: tool } = tools.get(view.operation)!
      const uri = view.resource_uri ?? `ui://zebric/${view.name}.html`
      // Resolve the real tool name from registration; applicationName can change its prefix.
      const readOnly = tool.annotations?.readOnlyHint === true
      const html = renderMcpApp(view, { toolName: name, readOnly })
      const ui = { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true }
      server.registerResource(view.name, uri, {
        title: view.title,
        mimeType: MCP_APP_MIME_TYPE,
        _meta: { ui },
      }, async () => ({
        contents: [{ uri, mimeType: MCP_APP_MIME_TYPE, text: html, _meta: { ui } }],
      }))
      // The view only ever calls read tools, so mutations stay model-only.
      const visibility = readOnly ? ['model', 'app'] : ['model']
      tool.update({ _meta: { ...tool._meta, ui: { resourceUri: uri, visibility } } })
    }
  }
}
