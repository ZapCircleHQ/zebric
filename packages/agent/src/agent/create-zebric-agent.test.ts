import { describe, expect, it } from 'vitest'
import { createZebricAgent } from './create-zebric-agent.js'

describe('createZebricAgent', () => {
  it('constructs a Deep Agent without invoking the model', () => {
    const agent = createZebricAgent({ model: 'openai:test-model' })

    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })
})
