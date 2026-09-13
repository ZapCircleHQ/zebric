import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowExecutor } from './workflow-executor.js'
import type { Workflow, WorkflowContext, WorkflowStep } from './types.js'

function context(variables: Record<string, any> = {}): WorkflowContext {
  return { trigger: { type: 'manual' }, variables }
}

function workflow(steps: WorkflowStep[], overrides: Partial<Workflow> = {}): Workflow {
  return {
    name: 'edge-cases',
    trigger: { manual: true },
    steps,
    ...overrides,
  }
}

function dataLayer(overrides: Record<string, any> = {}) {
  return {
    create: vi.fn().mockResolvedValue({ id: 'created-1' }),
    update: vi.fn().mockResolvedValue({ id: 'record-1', state: 'updated' }),
    delete: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue({ id: 'record-1', state: 'before' }),
    execute: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('WorkflowExecutor control flow', () => {
  let layer: ReturnType<typeof dataLayer>

  beforeEach(() => {
    layer = dataLayer()
  })

  it('executes both condition branches according to workflow context', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const executor = new WorkflowExecutor({ dataLayer: layer as any, httpClient: { request } })
    const step: WorkflowStep = {
      type: 'condition',
      if: { 'variables.approved': true },
      then: [{ type: 'webhook', url: 'https://example.test/approved', method: 'POST' }],
      else: [{ type: 'webhook', url: 'https://example.test/rejected', method: 'POST' }],
    }

    expect((await executor.execute(workflow([step]), context({ approved: true }))).success).toBe(true)
    expect((await executor.execute(workflow([step]), context({ approved: false }))).success).toBe(true)

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/approved',
      'https://example.test/rejected',
    ])
  })

  it.each([
    [{ type: 'condition' }, 'Condition step requires if clause'],
    [{ type: 'loop', do: [] }, 'Loop step requires items'],
    [{ type: 'loop', items: 'variables.items' }, 'Loop step requires do'],
    [{ type: 'loop', items: 'variables.items', do: [] }, 'Loop items must be an array, got: string'],
    [{ type: 'delay' }, 'Delay step requires duration'],
    [{ type: 'delay', duration: -1 }, 'Invalid delay duration: -1'],
    [{ type: 'unknown' }, 'Unknown step type: unknown'],
  ])('fails closed for an invalid control-flow step', async (rawStep, message) => {
    const executor = new WorkflowExecutor({ dataLayer: layer as any })

    const result = await executor.execute(workflow([rawStep as WorkflowStep]), context())

    expect(result).toMatchObject({ success: false, error: message })
  })

  it('iterates arrays referenced by a context path without stringifying them', async () => {
    const action = vi.fn((params) => params)
    const executor = new WorkflowExecutor({
      dataLayer: layer as any,
      pluginRegistry: { getPlugin: () => ({ actions: { process: action } }) },
    })

    const result = await executor.execute(workflow([{
      type: 'loop',
      items: 'variables.items',
      do: [{
        type: 'plugin', plugin: 'orders', action_name: 'process',
        params: { id: '{{variables.item.id}}', index: '{{variables.index}}' },
      }],
      assignTo: 'processed',
    }]), context({ items: [{ id: 'a' }, { id: 'b' }] }))

    expect(result.success).toBe(true)
    expect(action).toHaveBeenNthCalledWith(
      1, { id: 'a', index: '0' }, expect.objectContaining({ variables: expect.any(Object) }),
    )
    expect(action).toHaveBeenNthCalledWith(
      2, { id: 'b', index: '1' }, expect.objectContaining({ variables: expect.any(Object) }),
    )
    expect(result.result?.processed).toEqual([{ id: 'a', index: '0' }, { id: 'b', index: '1' }])
  })

  it('also accepts an exact mustache expression as a loop source', async () => {
    const action = vi.fn(() => 'done')
    const executor = new WorkflowExecutor({
      dataLayer: layer as any,
      pluginRegistry: { getPlugin: () => ({ actions: { process: action } }) },
    })

    const result = await executor.execute(workflow([{
      type: 'loop', items: '{{ variables.items }}',
      do: [{ type: 'plugin', plugin: 'orders', action_name: 'process' }],
    }]), context({ items: [1, 2, 3] }))

    expect(result.success).toBe(true)
    expect(action).toHaveBeenCalledTimes(3)
  })

  it('executes numeric and interpolated delays', async () => {
    vi.useFakeTimers()
    const executor = new WorkflowExecutor({ dataLayer: layer as any })

    const execution = executor.execute(workflow([
      { type: 'delay', duration: 10 },
      { type: 'delay', duration: '{{variables.delay}}' as any },
    ]), context({ delay: 15 }))
    await vi.advanceTimersByTimeAsync(25)

    expect((await execution).success).toBe(true)
    vi.useRealTimers()
  })
})

describe('WorkflowExecutor plugin boundaries', () => {
  const cases: Array<[Record<string, any>, WorkflowStep, string]> = [
    [{}, { type: 'plugin', plugin: 'demo', action_name: 'run' }, 'Plugin registry not configured'],
    [{ pluginRegistry: {} }, { type: 'plugin', action_name: 'run' }, 'Plugin step requires plugin'],
    [{ pluginRegistry: {} }, { type: 'plugin', plugin: 'demo' }, 'Plugin step requires action_name'],
    [{ pluginRegistry: { getPlugin: () => undefined } },
      { type: 'plugin', plugin: 'demo', action_name: 'run' }, 'Plugin not found: demo'],
    [{ pluginRegistry: { getPlugin: () => ({ actions: { run: 'not-a-function' } }) } },
      { type: 'plugin', plugin: 'demo', action_name: 'run' }, 'Action not found: demo.run'],
    [{ pluginRegistry: { getPlugin: () => ({}) } },
      { type: 'plugin', plugin: 'demo', action_name: 'run' }, 'Action not found: demo.run'],
  ]

  it.each(cases)('rejects invalid plugin configuration', async (options, step, message) => {
    const executor = new WorkflowExecutor({ dataLayer: dataLayer() as any, ...options })

    const result = await executor.execute(workflow([step]), context())

    expect(result).toMatchObject({ success: false, error: message })
  })

  it('resolves plugin parameters and assigns the action result', async () => {
    const action = vi.fn().mockReturnValue({ accepted: true })
    const executor = new WorkflowExecutor({
      dataLayer: dataLayer() as any,
      pluginRegistry: { getPlugin: vi.fn().mockReturnValue({ actions: { run: action } }) },
    })
    const executionContext = context({ orderId: 'order-1' })

    const result = await executor.execute(workflow([{
      type: 'plugin', plugin: 'demo', action_name: 'run',
      params: { id: '{{variables.orderId}}' }, assignTo: 'pluginResult',
    }]), executionContext)

    expect(result.success).toBe(true)
    expect(action).toHaveBeenCalledWith({ id: 'order-1' }, executionContext)
    expect(result.result?.pluginResult).toEqual({ accepted: true })
  })
})

describe('WorkflowExecutor query guards and events', () => {
  it.each([
    [{ type: 'query', action: 'find' }, 'Query step requires entity'],
    [{ type: 'query', entity: 'Order', action: 'create' }, 'Create action requires data'],
    [{ type: 'query', entity: 'Order', action: 'update', where: { id: '1' } }, 'Update action requires data'],
    [{ type: 'query', entity: 'Order', action: 'update', data: {} }, 'Update action requires an id in the where clause'],
    [{ type: 'query', entity: 'Order', action: 'delete' }, 'Delete action requires an id in the where clause'],
    [{ type: 'query', entity: 'Order', action: 'invalid' }, 'Unknown query action: invalid'],
  ])('rejects an invalid query operation', async (rawStep, message) => {
    const executor = new WorkflowExecutor({ dataLayer: dataLayer() as any })

    const result = await executor.execute(workflow([rawStep as WorkflowStep]), context())

    expect(result).toMatchObject({ success: false, error: message })
  })

  it('uses atomic updateWhere conditions and propagates session and attribution', async () => {
    const session = { user: { id: 'user-1' } }
    const updateWhere = vi.fn().mockResolvedValue({ id: 'record-1', state: 'done' })
    const layer = dataLayer({ updateWhere })
    const onEntityEvent = vi.fn()
    const executor = new WorkflowExecutor({ dataLayer: layer as any, onEntityEvent })
    const executionContext: WorkflowContext = {
      ...context({
        data: { attribution: { actorType: 'agent', agentId: 'agent-1' } },
        __zebric: { depth: 2, workflowPath: ['parent'] },
      }),
      session,
      trace: { executionId: 'execution-1' },
    }

    const result = await executor.execute(workflow([{
      type: 'query', entity: 'Order', action: 'update',
      where: { id: 123, state: 'pending' }, data: { state: 'done' },
    }]), executionContext)

    expect(result.success).toBe(true)
    expect(layer.findById).toHaveBeenCalledWith('Order', '123', { session })
    expect(updateWhere).toHaveBeenCalledWith(
      'Order', '123', { state: 'pending' }, { state: 'done' }, { session },
    )
    expect(onEntityEvent).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'Order', event: 'update', sourceWorkflow: 'edge-cases', depth: 2,
      workflowPath: ['parent'], session, trace: { executionId: 'execution-1' },
      attribution: { actorType: 'agent', agentId: 'agent-1' },
    }))
  })

  it('uses the requested ID as delete event data when the record is already absent', async () => {
    const layer = dataLayer({ findById: vi.fn().mockResolvedValue(null) })
    const onEntityEvent = vi.fn()
    const executor = new WorkflowExecutor({ dataLayer: layer as any, onEntityEvent })

    const result = await executor.execute(workflow([{
      type: 'query', entity: 'Order', action: 'delete', where: 'record-1' as any,
    }]), context())

    expect(result.success).toBe(true)
    expect(layer.delete).toHaveBeenCalledWith('Order', 'record-1')
    expect(onEntityEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'delete', before: { id: 'record-1' }, after: undefined,
    }))
  })

  it('supports transactional guards and workflows without entity listeners', async () => {
    const layer = dataLayer()
    const executor = new WorkflowExecutor({ dataLayer: layer as any })

    const unsupported = await executor.execute(
      workflow([], { transactional: true, name: 'atomic-workflow' }), context(),
    )
    expect(unsupported).toMatchObject({
      success: false,
      error: 'Transactional workflow atomic-workflow requires transaction support',
    })

    const created = await executor.execute(workflow([{
      type: 'query', entity: 'Order', action: 'create', data: { state: 'new' },
    }]), context())
    expect(created.success).toBe(true)
  })
})
