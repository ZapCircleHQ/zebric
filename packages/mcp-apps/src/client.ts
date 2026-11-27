/** Self-contained MCP Apps bridge; no CDN, network requests, or runtime dependencies. */
export const MCP_APP_CLIENT = String.raw`
(() => {
  const config = JSON.parse(document.getElementById('config').textContent);
  const content = document.getElementById('content');
  const status = document.getElementById('status');
  const refresh = document.getElementById('refresh');
  const pending = new Map();
  let nextId = 1;
  let initialized = false;
  let args;
  let hasInput = false;
  let serverTools = false;
  let busy = false;
  let cancelled = false;
  // Bumped by host input, results, or cancellation so a slower refresh cannot overwrite newer state.
  let generation = 0;
  // The parent is the host's sandbox proxy; its origin may be opaque.
  function send(message) { window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*'); }
  function notify(method, params = {}) { send({ method, params }); }
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The host did not respond.'));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });
  }
  function updateRefresh() {
    refresh.hidden = !serverTools || config.binding?.readOnly !== true;
    refresh.disabled = !initialized || !hasInput || busy || cancelled;
  }
  function hostContext(context) {
    if (!context) return;
    if (context.theme === 'dark' || context.theme === 'light') document.documentElement.style.colorScheme = context.theme;
    for (const [name, value] of Object.entries(context.styles?.variables || {})) {
      if (/^--(color-|font-|border-|radius-|spacing-)/.test(name) && typeof value === 'string') {
        document.documentElement.style.setProperty(name, value);
      }
    }
    updateRefresh();
  }
  function valueAt(value, path) {
    return path.split('.').reduce((result, key) => result !== null && typeof result === 'object' &&
      Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined, value);
  }
  function text(value) {
    return value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  function element(tag, value) {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = text(value);
    return node;
  }
  function resultData(result) {
    if (result.structuredContent !== undefined) return result.structuredContent;
    const value = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    try { return JSON.parse(value); } catch { return value; }
  }
  function render(result) {
    content.replaceChildren();
    if (result.isError) {
      status.textContent = text(resultData(result)?.error?.message || resultData(result) || 'The operation failed.');
      return;
    }
    let data = resultData(result);
    if (config.data_path) data = valueAt(data, config.data_path);
    const rows = Array.isArray(data) ? data : data === undefined || data === null ? [] : [data];
    if (!rows.length) {
      status.textContent = config.empty || 'No records to display.';
      return;
    }
    const first = rows[0];
    const fields = (config.fields || (first && typeof first === 'object' ? Object.keys(first) : ['value']))
      .map(field => typeof field === 'string' ? { field, label: field } : { ...field, label: field.label || field.field });
    const cell = (row, field) => row !== null && typeof row === 'object' ? valueAt(row, field) : field === 'value' ? row : undefined;
    if (config.layout === 'table') {
      const table = element('table');
      const head = element('thead');
      const header = element('tr');
      fields.forEach(field => { const th = element('th', field.label); th.scope = 'col'; header.append(th); });
      head.append(header);
      const body = element('tbody');
      rows.forEach(row => { const tr = element('tr'); fields.forEach(field => tr.append(element('td', cell(row, field.field)))); body.append(tr); });
      table.append(head, body);
      content.append(table);
    } else {
      rows.forEach(row => {
        const list = element('dl');
        fields.forEach(field => list.append(element('dt', field.label), element('dd', cell(row, field.field))));
        content.append(list);
      });
    }
    status.textContent = '';
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (!message.method && pending.has(message.id)) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message || 'The host rejected the request.'));
      else call.resolve(message.result);
      return;
    }
    if (message.method === 'ping' && message.id !== undefined) {
      send({ id: message.id, result: {} });
      return;
    }
    if (message.method === 'ui/resource-teardown' && message.id !== undefined) {
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('View closed.')); }
      pending.clear();
      initialized = false;
      observer?.disconnect();
      updateRefresh();
      send({ id: message.id, result: {} });
      return;
    }
    if (!initialized) return;
    if (message.method === 'ui/notifications/tool-input') {
      generation++;
      args = message.params?.arguments || {};
      hasInput = true;
      cancelled = false;
      updateRefresh();
    } else if (message.method === 'ui/notifications/tool-result') {
      generation++;
      render(message.params || {});
    } else if (message.method === 'ui/notifications/tool-cancelled') {
      generation++;
      cancelled = true;
      status.textContent = message.params?.reason || 'Operation cancelled.';
      updateRefresh();
    } else if (message.method === 'ui/notifications/host-context-changed') {
      hostContext(message.params);
    } else if (message.id !== undefined) {
      send({ id: message.id, error: { code: -32601, message: 'Method not found' } });
    }
  });
  refresh.addEventListener('click', async () => {
    if (refresh.disabled || refresh.hidden) return;
    busy = true;
    updateRefresh();
    status.textContent = 'Refreshing…';
    const started = generation;
    try {
      const result = await request('tools/call', { name: config.binding.toolName, arguments: args });
      if (started === generation) render(result);
    } catch (error) {
      if (started === generation) status.textContent = error.message;
    } finally { busy = false; updateRefresh(); }
  });
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    if (initialized) notify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight });
  });
  observer?.observe(document.body);
  request('ui/initialize', {
    appInfo: { name: 'zebric-' + config.name, version: config.version },
    appCapabilities: { availableDisplayModes: ['inline'] },
    protocolVersion: '2026-01-26',
  }).then(result => {
    // Hosts may negotiate a newer version. The messages used here are part of every
    // version so far, so render anyway rather than blanking the view.
    if (typeof result?.protocolVersion !== 'string') throw new Error('The host did not report an MCP Apps protocol version.');
    if (result.protocolVersion !== '2026-01-26') console.warn('MCP Apps host negotiated protocol ' + result.protocolVersion + '; this view targets 2026-01-26.');
    serverTools = Boolean(result.hostCapabilities?.serverTools);
    hostContext(result.hostContext);
    initialized = true;
    status.textContent = 'Waiting for results…';
    updateRefresh();
    notify('ui/notifications/initialized');
    notify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight });
  }).catch(error => { status.textContent = error.message; });
})();
`
