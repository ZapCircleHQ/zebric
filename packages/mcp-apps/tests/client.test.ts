import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { renderMcpApp } from '../src/render.js'

class Element {
  textContent = ''
  children: Element[] = []
  hidden = false
  disabled = true
  style = { colorScheme: '', setProperty: vi.fn() }
  handlers = new Map<string, () => unknown>()
  constructor(readonly tag: string) {}
  append(...nodes: Element[]) { this.children.push(...nodes) }
  replaceChildren() { this.children = [] }
  addEventListener(name: string, fn: () => unknown) { this.handlers.set(name, fn) }
}

function view(layout: 'table' | 'detail' = 'table', readOnly = true) {
  const html = renderMcpApp({ name: 'items', title: 'Items', operation: 'items_list', layout, data_path: 'items', fields: [{ field: 'title', label: 'Title' }, 'owner.name'] }, { toolName: 'custom_items_list', readOnly })
  const nodes = new Map(['config', 'content', 'status', 'refresh'].map(id => [id, new Element(id)]))
  nodes.get('config')!.textContent = html.match(/id="config">(.*?)<\/script>/s)![1]
  const messages: Record<string, unknown>[] = []
  const warn = vi.fn()
  const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) }
  let receive!: (event: object) => void
  const doc = { getElementById: (id: string) => nodes.get(id), createElement: (tag: string) => new Element(tag), documentElement: { style: new Element('root').style, scrollHeight: 400 }, body: {} }
  runInNewContext(html.match(/<script>(.*?)<\/script>/s)![1], {
    document: doc, window: { parent, addEventListener: (_name: string, handler: typeof receive) => { receive = handler } },
    setTimeout, clearTimeout, console: { warn },
  })
  const send = (message: object, source: unknown = parent) => receive({ source, data: { jsonrpc: '2.0', ...message } })
  const initialize = async (capabilities = { serverTools: {} }, protocolVersion: string | null = '2026-01-26') => {
    send({ id: messages[0].id, result: { protocolVersion, hostCapabilities: capabilities, hostContext: { theme: 'dark' } } })
    await Promise.resolve()
    await Promise.resolve()
  }
  return { html, nodes, messages, send, initialize, doc, warn }
}

describe('sandboxed view client', () => {
  it('performs the lifecycle handshake and renders results as text, including nested fields', async () => {
    const app = view()
    expect(app.messages[0].method).toBe('ui/initialize')
    await app.initialize()
    expect(app.messages.map(message => message.method)).toContain('ui/notifications/initialized')
    app.send({ method: 'ui/notifications/tool-input', params: { arguments: { status: 'open' } } })
    app.send({ method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: JSON.stringify({ items: [{ title: '<img onerror=alert(1)>', owner: { name: 'Sam' } }] }) }] } })
    const table = app.nodes.get('content')!.children[0]
    expect(table.tag).toBe('table')
    expect(table.children[1].children[0].children.map(node => node.textContent)).toEqual(['<img onerror=alert(1)>', 'Sam'])
    expect(app.doc.documentElement.style.colorScheme).toBe('dark')
  })

  it('refreshes the bound read tool using the original arguments through the host', async () => {
    const app = view()
    await app.initialize()
    app.send({ method: 'ui/notifications/tool-input', params: { arguments: { page: 2 } } })
    const refreshing = app.nodes.get('refresh')!.handlers.get('click')!()
    const request = app.messages.at(-1)!
    expect(request).toMatchObject({ method: 'tools/call', params: { name: 'custom_items_list', arguments: { page: 2 } } })
    expect(app.messages[0]).toMatchObject({ params: { appInfo: { name: 'zebric-items', version: expect.any(String) } } })
    app.send({ id: request.id, result: { structuredContent: { items: [] } } })
    await refreshing
    expect(app.nodes.get('status')!.textContent).toBe('No records to display.')
  })

  it('drops a refresh result superseded by newer host data', async () => {
    const app = view()
    await app.initialize()
    app.send({ method: 'ui/notifications/tool-input', params: { arguments: { page: 1 } } })
    const refreshing = app.nodes.get('refresh')!.handlers.get('click')!()
    const request = app.messages.at(-1)!
    app.send({ method: 'ui/notifications/tool-input', params: { arguments: { page: 2 } } })
    app.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { items: [{ title: 'Newer', owner: { name: 'Ada' } }] } } })
    app.send({ id: request.id, result: { structuredContent: { items: [{ title: 'Stale', owner: { name: 'Sam' } }] } } })
    await refreshing
    const rows = app.nodes.get('content')!.children[0].children[1].children
    expect(rows.map(row => row.children[0].textContent)).toEqual(['Newer'])
    expect(app.nodes.get('refresh')!.disabled).toBe(false)
  })

  it.each(['result', 'error'] as const)('preserves cancellation when a pending refresh settles with %s', async outcome => {
    const app = view()
    await app.initialize()
    app.send({ method: 'ui/notifications/tool-input', params: { arguments: {} } })
    const refreshing = app.nodes.get('refresh')!.handlers.get('click')!()
    const request = app.messages.at(-1)!
    expect(request.method).toBe('tools/call')

    app.send({ method: 'ui/notifications/tool-cancelled', params: { reason: 'Stopped by user' } })
    expect(app.nodes.get('status')!.textContent).toBe('Stopped by user')
    expect(app.nodes.get('refresh')!.disabled).toBe(true)

    app.send(outcome === 'result'
      ? { id: request.id, result: { structuredContent: { items: [{ title: 'Stale', owner: { name: 'Sam' } }] } } }
      : { id: request.id, error: { code: -32603, message: 'Late refresh failure' } })
    await refreshing

    expect(app.nodes.get('status')!.textContent).toBe('Stopped by user')
    expect(app.nodes.get('content')!.children).toHaveLength(0)
    expect(app.nodes.get('refresh')!.disabled).toBe(true)
  })

  it('ignores messages from other windows and hides mutation refresh', async () => {
    const app = view('detail', false)
    app.send({ id: app.messages[0].id, result: {} }, {})
    expect(app.messages).toHaveLength(1)
    await app.initialize()
    app.send({ method: 'ui/notifications/tool-input', params: { arguments: {} } })
    app.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { items: [{ title: 'Done', owner: { name: 'Sam' } }] } } })
    expect(app.nodes.get('content')!.children[0].tag).toBe('dl')
    expect(app.nodes.get('refresh')!.hidden).toBe(true)
    await app.nodes.get('refresh')!.handlers.get('click')!()
    expect(app.messages.some(message => message.method === 'tools/call')).toBe(false)
  })

  it('handles tool errors, cancellation, ping, and teardown', async () => {
    const app = view()
    await app.initialize()
    app.send({ method: 'ui/notifications/tool-result', params: { isError: true, structuredContent: { error: { message: 'Forbidden' } } } })
    expect(app.nodes.get('status')!.textContent).toBe('Forbidden')
    app.send({ method: 'ui/notifications/tool-cancelled', params: { reason: 'Stopped' } })
    expect(app.nodes.get('refresh')!.disabled).toBe(true)
    app.send({ id: 'health', method: 'ping' })
    expect(app.messages.at(-1)).toMatchObject({ id: 'health', result: {} })
    app.send({ id: 'close', method: 'ui/resource-teardown' })
    expect(app.messages.at(-1)).toMatchObject({ id: 'close', result: {} })
  })

  it('still renders when the host negotiates a newer protocol version', async () => {
    const app = view()
    await app.initialize(undefined, '2027-06-01')
    expect(app.messages.map(message => message.method)).toContain('ui/notifications/initialized')
    expect(app.warn).toHaveBeenCalledWith(expect.stringContaining('2027-06-01'))
    app.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { items: [{ title: 'Next', owner: { name: 'Ada' } }] } } })
    expect(app.nodes.get('content')!.children[0].tag).toBe('table')
  })

  it('reports an initialize result without a protocol version', async () => {
    const app = view()
    await app.initialize(undefined, null)
    expect(app.messages.map(message => message.method)).not.toContain('ui/notifications/initialized')
    expect(app.nodes.get('status')!.textContent).toBe('The host did not report an MCP Apps protocol version.')
  })

  it('escapes HTML and script-breaking configuration', () => {
    const html = renderMcpApp({ name: 'safe', title: '</script><script>alert(1)</script>', operation: 'list', layout: 'table' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;/script&gt;')
    expect(html).toContain('\\u003c/script>')
  })
})
