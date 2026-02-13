/**
 * Miniflare Integration Test Setup
 *
 * Provides real CloudFlare Workers environment for integration testing.
 */

import { Miniflare } from 'miniflare'
import type { Blueprint } from '@zebric/runtime-core'
import { ZebricWorkersEngine } from '../../src/engine.js'
import type { WorkersEnv } from '../../src/engine.js'

export interface TestEnvironment {
  mf: Miniflare
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  cleanup: () => Promise<void>
}

/**
 * Create a test environment with Miniflare
 */
export async function createTestEnvironment(blueprint: Blueprint): Promise<TestEnvironment> {
  // Create Miniflare instance with D1, KV, and R2
  const mf = new Miniflare({
    modules: true,
    script: `
      export default {
        async fetch(request, env) {
          // Blueprint will be passed via env.BLUEPRINT
          return new Response(JSON.stringify({ test: true }))
        }
      }
    `,
    compatibilityDate: '2025-01-10',
    d1Databases: {
      DB: 'd1:test-db'
    },
    kvNamespaces: {
      SESSION_KV: 'session-kv',
      CACHE_KV: 'cache-kv'
    },
    r2Buckets: {
      FILES_R2: 'files-r2'
    },
    bindings: {
      BLUEPRINT: JSON.stringify(blueprint)
    }
  })

  // Helper to make fetch requests - use the engine directly
  const fetch = async (url: string, init?: RequestInit) => {
    const fullUrl = url.startsWith('http') ? url : `http://localhost${url}`
    const request = new Request(fullUrl, init)

    // Get bindings from Miniflare
    const db = await mf.getD1Database('DB')
    const sessionKV = await mf.getKVNamespace('SESSION_KV')
    const cacheKV = await mf.getKVNamespace('CACHE_KV')

    const env: WorkersEnv = {
      DB: db,
      SESSION_KV: sessionKV,
      CACHE_KV: cacheKV,
      BLUEPRINT: JSON.stringify(blueprint)
    }

    const engine = new ZebricWorkersEngine({ env, blueprint })
    return engine.fetch(request)
  }

  // Cleanup function
  const cleanup = async () => {
    await mf.dispose()
  }

  return { mf, fetch, cleanup }
}

/**
 * Get D1 database from Miniflare for direct queries
 */
export async function getD1Database(mf: Miniflare): Promise<D1Database> {
  return mf.getD1Database('DB')
}

/**
 * Get KV namespace from Miniflare
 */
export async function getKVNamespace(mf: Miniflare, name: string): Promise<KVNamespace> {
  return mf.getKVNamespace(name)
}

/**
 * Run database migration
 */
export async function runMigration(db: D1Database, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await db.prepare(statement).run()
  }
}

/**
 * Create a simple test blueprint
 */
export function createTestBlueprint(): Blueprint {
  return {
    version: '1.0.0',
    hash: 'test-hash',
    project: {
      name: 'Test App',
      version: '1.0.0',
      description: 'Integration test application',
      runtime: { min_version: '0.2.0' }
    },
    entities: [
      {
        name: 'Task',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true, required: true },
          { name: 'title', type: 'Text', required: true },
          { name: 'description', type: 'LongText', nullable: true },
          { name: 'status', type: 'Enum', values: ['pending', 'in_progress', 'completed'], default: 'pending' },
          { name: 'priority', type: 'Integer', default: 0 },
          { name: 'userId', type: 'Text', nullable: true },
          { name: 'createdAt', type: 'DateTime', default: 'now()' }
        ],
        access: {
          create: 'public',
          read: 'public',
          update: 'public',
          delete: 'public'
        }
      },
      {
        name: 'User',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true, required: true },
          { name: 'name', type: 'Text', required: true },
          { name: 'email', type: 'Email', required: true, unique: true },
          { name: 'createdAt', type: 'DateTime', default: 'now()' }
        ]
      }
    ],
    pages: [
      {
        path: '/',
        title: 'Home',
        layout: 'dashboard',
        auth: 'optional',
        queries: {
          stats: {
            entity: 'Task',
            where: {}
          }
        }
      },
      {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        auth: 'optional',
        queries: {
          tasks: {
            entity: 'Task',
            where: {},
            orderBy: { createdAt: 'desc' },
            limit: 20
          }
        }
      },
      {
        path: '/tasks/{id}',
        title: 'Task Detail',
        layout: 'detail',
        auth: 'optional',
        queries: {
          task: {
            entity: 'Task',
            where: { id: '{id}' }
          }
        },
        form: {
          entity: 'Task',
          method: 'delete',
          fields: [],
          onSuccess: {
            redirect: '/tasks',
            message: 'Deleted successfully'
          }
        }
      },
      {
        path: '/tasks/new',
        title: 'New Task',
        layout: 'form',
        auth: 'optional',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [
            { name: 'title', type: 'text', required: true, label: 'Title' },
            { name: 'description', type: 'textarea', required: false, label: 'Description', rows: 4 },
            { name: 'status', type: 'select', required: true, label: 'Status', options: ['pending', 'in_progress', 'completed'] },
            { name: 'priority', type: 'number', required: false, label: 'Priority', min: 0, max: 10 }
          ],
          onSuccess: {
            redirect: '/tasks/{id}',
            message: 'Task created successfully'
          }
        }
      },
      {
        path: '/tasks/{id}/edit',
        title: 'Edit Task',
        layout: 'form',
        auth: 'optional',
        queries: {
          task: {
            entity: 'Task',
            where: { id: '{id}' }
          }
        },
        form: {
          entity: 'Task',
          method: 'update',
          fields: [
            { name: 'title', type: 'text', required: true, label: 'Title' },
            { name: 'description', type: 'textarea', required: false, label: 'Description', rows: 4 },
            { name: 'status', type: 'select', required: true, label: 'Status', options: ['pending', 'in_progress', 'completed'] },
            { name: 'priority', type: 'number', required: false, label: 'Priority', min: 0, max: 10 }
          ],
          onSuccess: {
            redirect: '/tasks/{id}',
            message: 'Task updated successfully'
          }
        }
      }
    ]
  }
}

/**
 * Database migration for test schema
 */
export const testMigration = [
  `CREATE TABLE IF NOT EXISTS Task (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    userId TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_status ON Task(status)`,
  `CREATE INDEX IF NOT EXISTS idx_task_userId ON Task(userId)`,
  `CREATE TABLE IF NOT EXISTS User (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_email ON User(email)`
]
