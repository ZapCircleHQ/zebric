import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import { CommandExecutor, SYSTEM_SESSION } from '@zebric/runtime-core'
import { D1Adapter } from '../../src/database/d1-adapter.js'
import { D1IdempotencyConflict, D1TransactionConflict } from '../../src/database/d1-transactions.js'
import { WorkersQueryExecutor } from '../../src/query/workers-query-executor.js'
import { D1WorkflowExecutor } from '../../src/workflows/d1-workflow-executor.js'

const entity = {
  name: 'Item',
  fields: [
    { name: 'id', type: 'Text', primary_key: true },
    { name: 'value', type: 'Text' }
  ]
}
const blueprint = {
  entities: [entity],
  commands: [
    {
      name: 'Change',
      entity: 'Item',
      mutations: { value: 'input.value' },
      input: { value: { type: 'Text', required: true } }
    }
  ]
} as any
const context = { session: SYSTEM_SESSION }

describe('D1 snapshot transactions and durable receipts', () => {
  let mf: Miniflare
  let db: D1Adapter
  let queries: WorkersQueryExecutor
  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28',
      d1Databases: { DB: 'transactions' }
    })
    db = new D1Adapter(await mf.getD1Database('DB'))
    await db.query("CREATE TABLE Item (id TEXT PRIMARY KEY, value TEXT DEFAULT 'default')")
    queries = new WorkersQueryExecutor(db, blueprint)
  })
  afterAll(async () => {
    await mf?.dispose()
  })

  it('reads its writes while hiding them from other requests and rolls back failures', async () => {
    let committed = 0
    await expect(
      queries.transaction(async () => {
        const created = await queries.create('Item', { id: 'rollback' }, context)
        expect(created.value).toBe('default')
        await queries.update('Item', created.id, { value: 'changed' }, context)
        expect((await queries.findById('Item', created.id, context)).value).toBe('changed')
        expect((await db.query('SELECT * FROM Item WHERE id = ?', [created.id])).rows).toEqual([])
        await queries.afterCommit(async () => {
          committed++
        })
        throw new Error('abort')
      })
    ).rejects.toThrow('abort')
    expect(committed).toBe(0)
    expect(await queries.findById('Item', 'rollback', context)).toBeNull()
  })

  it('commits read-dependent loops and commands together and emits events after commit', async () => {
    await db.query('INSERT INTO Item VALUES (?, ?)', ['dynamic', 'ready'])
    const definition = {
      ...blueprint,
      workflows: [
        {
          name: 'Dynamic',
          transactional: true,
          retries: 1,
          trigger: { manual: true },
          steps: [
            { type: 'query', entity: 'Item', action: 'find', where: { id: 'dynamic' }, assignTo: 'items' },
            {
              type: 'loop',
              items: 'variables.items',
              do: [
                {
                  type: 'condition',
                  if: { 'variables.item.value': 'ready' },
                  then: [
                    {
                      type: 'command',
                      command: 'Change',
                      recordId: '{{variables.item.id}}',
                      input: { value: 'committed' },
                      assignTo: 'changed'
                    },
                    {
                      type: 'query',
                      entity: 'Item',
                      action: 'create',
                      data: { id: 'dependent', value: '{{variables.changed.value}}' }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    } as any
    const executor = new D1WorkflowExecutor(definition, db, queries, {
      commandExecutor: new CommandExecutor(definition, { queryExecutor: queries })
    })
    const result = await executor.triggerManual('Dynamic', {}, SYSTEM_SESSION)
    expect(result.status).toBe('completed')
    expect((await queries.findById('Item', 'dependent', context)).value).toBe('committed')
    expect((await queries.findById('Item', 'dynamic', context)).value).toBe('committed')
  })

  it('detects phantoms and refuses to overwrite concurrent writes', async () => {
    await db.query('INSERT INTO Item VALUES (?, ?)', ['concurrent', 'original'])
    await expect(
      queries.transaction(async () => {
        await queries.update('Item', 'concurrent', { value: 'transaction' }, context)
        await db.query('INSERT INTO Item VALUES (?, ?)', ['phantom', 'new'])
      })
    ).rejects.toBeInstanceOf(D1TransactionConflict)
    expect((await queries.findById('Item', 'concurrent', context)).value).toBe('original')
  })

  it('replays the original committed result across executors without running the operation', async () => {
    const receipt = { key: 'durable', fingerprint: 'same' }
    const result = await queries.transaction(
      async () => queries.create('Item', { id: 'receipt', value: 'first' }, context),
      receipt
    )
    await db.query('UPDATE Item SET value = ? WHERE id = ?', ['later', 'receipt'])
    const restarted = new WorkersQueryExecutor(new D1Adapter(await mf.getD1Database('DB')), blueprint)
    expect(
      await restarted.transaction(async () => {
        throw new Error('must not run')
      }, receipt)
    ).toEqual(result)
    await expect(
      restarted.transaction(async () => null, { ...receipt, fingerprint: 'different' })
    ).rejects.toBeInstanceOf(D1IdempotencyConflict)
  })

  it('commits only one concurrent request for the same durable key', async () => {
    let arrivals = 0
    let effects = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const execute = (executor: WorkersQueryExecutor) =>
      executor.transaction(
        async () => {
          await executor.create('Item', { id: 'once', value: 'one' }, context)
          await executor.afterCommit(async () => {
            effects++
          })
          if (++arrivals === 2) release()
          await barrier
          return { value: 'original-response' }
        },
        { key: 'concurrent-receipt', fingerprint: 'same' }
      )
    const results = await Promise.all([execute(queries), execute(new WorkersQueryExecutor(db, blueprint))])
    expect(results).toEqual([{ value: 'original-response' }, { value: 'original-response' }])
    expect(effects).toBe(1)
    expect((await db.query('SELECT * FROM Item WHERE id = ?', ['once'])).rows).toHaveLength(1)
  })

  it('rejects conflicting concurrent input without committing the losing mutation', async () => {
    let arrivals = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const execute = (value: string) => {
      const executor = new WorkersQueryExecutor(db, blueprint)
      return executor.transaction(
        async () => {
          await executor.create('Item', { id: 'conflicting-input', value }, context)
          if (++arrivals === 2) release()
          await barrier
          return { value }
        },
        { key: 'conflicting-receipt', fingerprint: value }
      )
    }
    const results = await Promise.allSettled([execute('one'), execute('two')])
    const succeeded = results.find((result) => result.status === 'fulfilled')!
    const failed = results.find((result) => result.status === 'rejected')!
    expect(failed.status === 'rejected' && failed.reason).toBeInstanceOf(D1IdempotencyConflict)
    expect((await queries.findById('Item', 'conflicting-input', context)).value).toBe(
      succeeded.status === 'fulfilled' && succeeded.value.value
    )
  })

  it('rolls back application writes when saving the durable receipt fails', async () => {
    const failing = new D1Adapter(await mf.getD1Database('DB'))
    const batch = failing.batch.bind(failing)
    failing.batch = async (statements) =>
      batch(
        statements.some((statement) => statement.sql.startsWith('INSERT INTO _zebric_command_receipts'))
          ? [...statements, { sql: 'INSERT INTO _zebric_command_receipts VALUES (NULL, NULL, NULL)' }]
          : statements
      )
    const executor = new WorkersQueryExecutor(failing, blueprint)
    await expect(
      executor.transaction(() => executor.create('Item', { id: 'receipt-failure' }, context), {
        key: 'failed',
        fingerprint: 'same'
      })
    ).rejects.toThrow()
    expect(await queries.findById('Item', 'receipt-failure', context)).toBeNull()
    expect((await db.query('SELECT * FROM _zebric_command_receipts WHERE key = ?', ['failed'])).rows).toEqual([])
    await queries.transaction(() => queries.create('Item', { id: 'receipt-failure' }, context), {
      key: 'failed',
      fingerprint: 'same'
    })
  })

  it('replays a committed workflow transaction after losing its native checkpoint', async () => {
    const workflow = {
      name: 'Checkpoint',
      transactional: true,
      trigger: { manual: true },
      steps: [
        {
          type: 'query',
          entity: 'Item',
          action: 'create',
          data: { id: 'checkpoint', value: 'committed' },
          assignTo: 'created'
        }
      ]
    }
    const definition = { ...blueprint, workflows: [workflow] } as any
    const payload = {
      workflow,
      job: { id: 'lost-checkpoint' },
      context: {
        session: SYSTEM_SESSION,
        variables: { __zebric: { currentWorkflow: 'Checkpoint', workflowPath: ['Checkpoint'] } }
      }
    } as any
    const executor = new D1WorkflowExecutor(definition, db, queries)
    await expect(
      executor.runDurable(structuredClone(payload), {
        do: async (name, _config, operation) => {
          const result = await operation()
          if (name === 'transaction') throw new Error('Worker ended before checkpoint')
          return result
        },
        sleep: async () => {}
      })
    ).rejects.toThrow('before checkpoint')
    const restarted = new D1WorkflowExecutor(definition, db, new WorkersQueryExecutor(db, definition))
    const result = await restarted.runDurable(structuredClone(payload), {
      do: async (_name, _config, operation) => operation(),
      sleep: async () => {}
    })
    expect(result.created).toEqual({ id: 'checkpoint', value: 'committed' })
    expect((await db.query('SELECT * FROM Item WHERE id = ?', ['checkpoint'])).rows).toHaveLength(1)
  })

  it('replays a nontransactional command step after losing its checkpoint', async () => {
    await db.query('INSERT INTO Item VALUES (?, ?)', ['command-checkpoint', 'ready'])
    const command = { ...blueprint.commands[0], availableWhen: 'record.value == "ready"' }
    const workflow = {
      name: 'CommandCheckpoint',
      trigger: { manual: true },
      steps: [
        {
          type: 'command',
          command: 'Change',
          recordId: 'command-checkpoint',
          input: { value: 'committed' },
          assignTo: 'changed'
        }
      ]
    }
    const definition = { ...blueprint, commands: [command], workflows: [workflow] } as any
    const payload = {
      workflow,
      job: { id: 'lost-command-checkpoint' },
      context: {
        session: SYSTEM_SESSION,
        variables: { __zebric: { currentWorkflow: workflow.name, workflowPath: [workflow.name] } }
      }
    } as any
    const makeExecutor = () => {
      const executor = new WorkersQueryExecutor(db, definition)
      return new D1WorkflowExecutor(definition, db, executor, {
        commandExecutor: new CommandExecutor(definition, { queryExecutor: executor })
      })
    }
    await expect(
      makeExecutor().runDurable(structuredClone(payload), {
        do: async (name, _config, operation) => {
          const result = await operation()
          if (name === 'steps.0') throw new Error('Lost command checkpoint')
          return result
        },
        sleep: async () => {}
      })
    ).rejects.toThrow('Lost command checkpoint')
    const result = await makeExecutor().runDurable(structuredClone(payload), {
      do: async (_name, _config, operation) => operation(),
      sleep: async () => {}
    })
    expect(result.changed).toEqual({ id: 'command-checkpoint', value: 'committed' })
  })

  it('preserves foreign keys and cascades with child tables declared first', async () => {
    await db.query('CREATE TABLE Parent (id TEXT PRIMARY KEY, value TEXT)')
    await db.query(
      'CREATE TABLE Child (id TEXT PRIMARY KEY, parentId TEXT REFERENCES Parent(id) ON DELETE CASCADE ON UPDATE CASCADE)'
    )
    const executor = new WorkersQueryExecutor(db, {
      entities: [
        {
          name: 'Child',
          fields: [
            { name: 'id', type: 'Text' },
            { name: 'parentId', type: 'Text' }
          ]
        },
        { name: 'Parent', fields: entity.fields }
      ]
    } as any)
    await executor.transaction(async () => {
      await executor.create('Parent', { id: 'parent', value: 'value' }, context)
      await executor.create('Child', { id: 'child', parentId: 'parent' }, context)
    })
    const parentFirst = new WorkersQueryExecutor(db, {
      entities: [
        { name: 'Parent', fields: entity.fields },
        {
          name: 'Child',
          fields: [
            { name: 'id', type: 'Text' },
            { name: 'parentId', type: 'Text' }
          ]
        }
      ]
    } as any)
    await parentFirst.transaction(async () => {
      expect((await parentFirst.findById('Child', 'child', context)).parentId).toBe('parent')
    })
    expect((await db.query('SELECT * FROM Child')).rows).toHaveLength(1)
    await executor.transaction(async () => {
      await executor.delete('Parent', 'parent', context)
      expect(await executor.findById('Child', 'child', context)).toBeNull()
    })
    expect((await db.query('SELECT * FROM Child')).rows).toEqual([])
    await expect(
      executor.transaction(() => executor.create('Child', { id: 'invalid', parentId: 'missing' }, context))
    ).rejects.toThrow()
    expect((await db.query('SELECT * FROM Child')).rows).toEqual([])
  })

  it('preserves autoincrement history and generated defaults', async () => {
    await db.query(
      "CREATE TABLE Generated (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT DEFAULT 'default', computed TEXT GENERATED ALWAYS AS (value || '!') STORED)"
    )
    await db.query('INSERT INTO Generated (id) VALUES (100)')
    await db.query('DELETE FROM Generated')
    const executor = new WorkersQueryExecutor(db, {
      entities: [
        {
          name: 'Generated',
          fields: [
            { name: 'id', type: 'Integer' },
            { name: 'value', type: 'Text' },
            { name: 'computed', type: 'Text' }
          ]
        }
      ]
    } as any)
    const created = await executor.transaction(() => executor.create('Generated', { value: 'hello' }, context))
    expect(created).toEqual({ id: 101, value: 'hello', computed: 'hello!' })
    expect((await db.query('SELECT * FROM Generated')).rows).toEqual([created])
  })

  it('preserves storage types in STRICT tables with ANY columns', async () => {
    await db.query('CREATE TABLE StorageTypes (id TEXT PRIMARY KEY, value ANY) STRICT')
    await db.query('INSERT INTO StorageTypes VALUES (?, ?)', ['text', '000123'])
    const executor = new WorkersQueryExecutor(db, { entities: [{ ...entity, name: 'StorageTypes' }] } as any)
    const row = await executor.transaction(() => executor.findById('StorageTypes', 'text', context))
    expect(row.value).toBe('000123')
  })

  it('rejects concurrent schema changes before any application writes', async () => {
    await expect(
      queries.transaction(async () => {
        await queries.create('Item', { id: 'schema-change' }, context)
        await db.query(
          "CREATE TRIGGER changed_schema AFTER INSERT ON Item BEGIN UPDATE Item SET value = 'triggered' WHERE id = NEW.id; END"
        )
      })
    ).rejects.toBeInstanceOf(D1TransactionConflict)
    await db.query('DROP TRIGGER changed_schema')
    expect(await queries.findById('Item', 'schema-change', context)).toBeNull()
  })

  it('joins nested transactions with the same callback semantics as Node', async () => {
    await queries.transaction(async () => {
      try {
        await queries.transaction(async () => {
          await queries.create('Item', { id: 'nested-joined', value: 'joined' }, context)
          throw new Error('handled by outer callback')
        })
      } catch {
        /* joining the outer transaction does not create a savepoint */
      }
      expect((await queries.findById('Item', 'nested-joined', context)).value).toBe('joined')
      expect((await db.query('SELECT * FROM Item WHERE id = ?', ['nested-joined'])).rows).toEqual([])
    })
    expect((await queries.findById('Item', 'nested-joined', context)).value).toBe('joined')
    await expect(
      queries.transaction(async () =>
        queries.transaction(async () => {
          await queries.create('Item', { id: 'nested-rollback' }, context)
          throw new Error('unhandled failure')
        })
      )
    ).rejects.toThrow('unhandled failure')
    expect(await queries.findById('Item', 'nested-rollback', context)).toBeNull()
  })

  it('prevents a timed out transaction from committing after its query finishes', async () => {
    const delayed = new D1Adapter(await mf.getD1Database('DB'))
    const query = delayed.query.bind(delayed)
    let resume!: () => void
    delayed.query = async (sql, params) => {
      const result = await query(sql, params)
      if (sql.trimStart().startsWith('INSERT INTO "_zebric_tx_'))
        await new Promise<void>((resolve) => {
          resume = resolve
        })
      return result as any
    }
    const definition = {
      ...blueprint,
      workflows: [
        {
          name: 'Timeout',
          transactional: true,
          timeout: 1000,
          retries: 1,
          trigger: { manual: true },
          steps: [{ type: 'query', entity: 'Item', action: 'create', data: { id: 'late-transaction' } }]
        }
      ]
    } as any
    const executor = new D1WorkflowExecutor(definition, delayed, new WorkersQueryExecutor(delayed, definition))
    const job = await executor.triggerManual('Timeout', {}, SYSTEM_SESSION)
    expect(job.status).toBe('failed')
    expect(job.error).toBe('Workflow execution timed out')
    expect(resume).toBeTypeOf('function')
    resume()
    await expect.poll(async () => (await db.query('SELECT * FROM _zebric_transaction_workspaces')).rows.length).toBe(0)
    expect(await queries.findById('Item', 'late-transaction', context)).toBeNull()
  })

  it('recovers expired workspace manifests without losing a committed result', async () => {
    const failing = new D1Adapter(await mf.getD1Database('DB'))
    const batch = failing.batch.bind(failing)
    failing.batch = async (statements) => {
      if (statements.some((statement) => statement.sql.startsWith('DROP TABLE')))
        throw new Error('Worker ended before cleanup')
      return batch(statements)
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const executor = new WorkersQueryExecutor(failing, blueprint)
      await executor.transaction(() => executor.create('Item', { id: 'cleanup-recovery' }, context))
    } finally {
      error.mockRestore()
    }
    expect((await db.query('SELECT * FROM _zebric_transaction_workspaces')).rows).toHaveLength(1)
    await db.query('UPDATE _zebric_transaction_workspaces SET expires_at = 0')
    await queries.transaction(async () => {})
    expect((await db.query('SELECT * FROM _zebric_transaction_workspaces')).rows).toEqual([])
    expect((await queries.findById('Item', 'cleanup-recovery', context)).value).toBe('default')
  })

  it('cleans isolated tables on commit and rollback', async () => {
    expect((await db.query("SELECT name FROM sqlite_master WHERE name LIKE '_zebric_tx_%'")).rows).toEqual([])
  })
})
