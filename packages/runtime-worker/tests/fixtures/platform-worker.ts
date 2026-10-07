import { createWorkerHandler } from '../../src/engine.js'

export default createWorkerHandler({
  blueprint: {
    version: '0.6.0', project: { name: 'Platform smoke', version: '1', runtime: { min_version: '0.6.0' } },
    entities: [{ name: 'Item', fields: [{ name: 'id', type: 'Text', primary_key: true }, { name: 'title', type: 'Text' }] }],
    pages: [], plugins: [{ name: 'bundled', enabled: true }],
    commands: [{ name: 'ChangeTitle', entity: 'Item', handler: 'change-title' }],
    notifications: { default: 'email', adapters: [{ name: 'email', type: 'email', config: { from: 'app@example.test' } }] },
  },
  sessionManager: { getSession: async () => ({ user: { id: 'operator', email: 'operator@example.test' } }) as any },
  plugins: {
    bundled: { name: 'bundled', version: '1', provides: {}, init: async api => {
      await api.db.create('Item', { id: 'init', title: 'Initialized' }, {})
      await api.storage.upload('note.txt', new TextEncoder().encode('workerd'), { contentType: 'text/plain' })
    } },
  },
  commandHandlers: { 'change-title': async context => {
    await context.db.update('Item', String(context.record.id), { title: 'Handled' })
  } },
})
