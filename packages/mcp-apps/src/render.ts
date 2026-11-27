import { McpAppViewSchema, ZEBRIC_VERSION, type McpAppView } from '@zebric/runtime-core'
import { MCP_APP_CLIENT } from './client.js'

/** Generate static HTML only. Caller credentials and application data never enter the resource. */
export function renderMcpApp(view: McpAppView, binding?: { toolName: string; readOnly: boolean }): string {
  const config = McpAppViewSchema.parse(view)
  const json = JSON.stringify({ ...config, binding, version: ZEBRIC_VERSION }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.title)}</title>
<style>
:root{color-scheme:light dark;font-family:var(--font-sans,system-ui,sans-serif);color:var(--color-text-primary,CanvasText);background:var(--color-background-primary,Canvas)}
body{margin:0;padding:16px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h1{font-size:1.1rem;margin:0}button{font:inherit;padding:6px 12px;border:1px solid var(--color-border-primary,GrayText);border-radius:6px;cursor:pointer;color:inherit;background:transparent}button:disabled{opacity:.5;cursor:default}#content{overflow:auto}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{padding:8px;text-align:left;border-bottom:1px solid var(--color-border-primary,GrayText);white-space:pre-wrap;overflow-wrap:anywhere}dt{font-weight:600;margin-top:12px}dd{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}#status{font-size:.9rem;color:var(--color-text-secondary,GrayText)}
</style></head><body><header><h1>${escapeHtml(config.title)}</h1><button id="refresh" disabled>Refresh</button></header>
<p id="status" role="status">Connecting…</p><div id="content"></div>
<script type="application/json" id="config">${json}</script><script>${MCP_APP_CLIENT}</script></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
