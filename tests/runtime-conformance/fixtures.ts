import type { Blueprint, UserSession } from '../../packages/runtime-core/src/index.js'

export const session = { user: { id: 'operator', email: 'operator@example.test', roles: ['operator'] } } as UserSession
export const blueprint: Blueprint = {
  version: '0.6.0',
  live: { reauthorize_interval_seconds: 1 },
  project: { name: 'Runtime conformance', version: '1.0.0', runtime: { min_version: '0.6.0' } },
  auth: { providers: [], apiKeys: [
    { name: 'writer', keyEnv: 'WRITER_KEY', roles: ['operator'], scopes: ['*'] },
    { name: 'reader', keyEnv: 'READER_KEY', roles: ['operator'], scopes: ['entity.item.list', 'entity.item.get'] },
  ] },
  entities: [{
    name: 'Item',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'title', type: 'Text' },
      { name: 'published', type: 'Boolean', default: false },
      { name: 'priority', type: 'Integer', default: 0 },
      { name: 'status', type: 'Text', default: 'draft', write: 'command-only', commands: ['PublishItem'] },
      { name: 'payload', type: 'JSON' },
      { name: 'scheduledAt', type: 'DateTime' },
      { name: 'createdAt', type: 'DateTime', default: 'now' },
      { name: 'updatedAt', type: 'DateTime' },
    ],
    access: { read: { or: [{ published: true }, 'authenticated'] }, create: 'authenticated', update: 'authenticated', delete: 'authenticated' },
  },
    { name: 'Other', fields: [{ name: 'id', type: 'ULID', primary_key: true }], access: { create: 'authenticated', read: 'authenticated' } },
    { name: 'Secret', fields: [{ name: 'id', type: 'ULID', primary_key: true }], access: { read: false } },
  ],
  pages: [
    { path: '/items', title: 'Items', layout: 'list', auth: 'optional', queries: { items: { entity: 'Item' } } },
    { path: '/live-items', title: 'Live items', live: true, layout: 'list', auth: 'required', queries: { items: { entity: 'Item' } } },
    { path: '/live-secret', title: 'Secret', live: true, auth: 'optional', queries: { secret: { entity: 'Secret' } } },
    { path: '/live-public', title: 'Published items', live: true, layout: 'list', auth: 'optional', queries: { items: { entity: 'Item', where: { published: true } } } },
    { path: '/new-item', title: 'New item', live: true, auth: 'required', layout: 'form',
      form: { entity: 'Item', method: 'create', fields: [{ name: 'title', type: 'text' }] } },
  ],
  workflows: [
    { name: 'UpdateItem', trigger: { manual: true }, transactional: true, retries: 1, steps: [
      { type: 'query', action: 'update', entity: 'Item', where: { id: 'source', priority: 0 }, data: { title: 'workflow update' } },
    ] },
    { name: 'DeleteItem', trigger: { manual: true }, transactional: true, retries: 1, steps: [
      { type: 'query', action: 'delete', entity: 'Item', where: { id: 'source', priority: 0 } },
    ] },
    { name: 'CopyItems', trigger: { manual: true }, transactional: true, retries: 1, steps: [
      { type: 'query', action: 'find', entity: 'Item', assignTo: 'items' },
      { type: 'loop', items: 'variables.items', do: [
        { type: 'condition', if: { 'variables.item.published': false }, then: [
          { type: 'query', action: 'create', entity: 'Item', data: {
            id: 'copy-{{variables.item.id}}', title: '{{variables.item.title}}',
            priority: '{{variables.item.priority}}', payload: '{{variables.item.payload}}',
          } },
        ] },
      ] },
    ] },
    { name: 'RollbackWorkflow', trigger: { manual: true }, transactional: true, retries: 1, steps: [
      { type: 'query', action: 'create', entity: 'Item', data: { id: 'workflow-rollback' } },
      { type: 'query', action: 'create', entity: 'Item', data: { id: 'workflow-rollback' } },
    ] },
  ],
  commands: [{ name: 'PublishItem', entity: 'Item', availableWhen: { status: 'draft' }, mutations: { status: 'published', published: true } }],
}
