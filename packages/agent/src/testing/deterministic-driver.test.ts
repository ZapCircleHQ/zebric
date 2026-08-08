import { describe, expect, it } from 'vitest'
import { DeterministicAgentDriver } from './deterministic-driver.js'

describe('DeterministicAgentDriver', () => {
  it('executes named calls and records a transcript', async () => {
    const driver = new DeterministicAgentDriver([{
      name: 'list_items',
      invoke: async input => JSON.stringify([{ id: input.id }]),
    }])

    const output = await driver.invoke({ tool: 'list_items', input: { id: 'one' } })

    expect(JSON.parse(String(output))).toEqual([{ id: 'one' }])
    expect(driver.transcript).toEqual([{
      tool: 'list_items', input: { id: 'one' }, output,
    }])
  })

  it('rejects undeclared tools', async () => {
    const driver = new DeterministicAgentDriver([])
    await expect(driver.invoke({ tool: 'invented', input: {} }))
      .rejects.toThrow('Unknown deterministic agent tool')
  })
})
