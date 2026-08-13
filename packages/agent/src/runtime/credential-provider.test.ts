import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialProvider, validateCredentialReference } from './credential-provider.js'

describe('credentialProvider', () => {
  const variable = 'ZEBRIC_AGENT_TEST_CREDENTIAL'
  afterEach(() => { delete process.env[variable] })

  it('resolves environment credentials at request time', async () => {
    const provider = credentialProvider({ type: 'env', name: variable })!
    process.env[variable] = 'first-secret'
    expect(await provider()).toBe('first-secret')
    process.env[variable] = 'rotated-secret'
    expect(await provider()).toBe('rotated-secret')
  })

  it('fails safely when an environment credential is absent', async () => {
    const provider = credentialProvider({ type: 'env', name: variable })!
    expect(() => provider()).toThrow(variable)
  })

  it('validates references before they are used', () => {
    expect(() => validateCredentialReference({ type: 'env', name: 'bad-name' }))
      .toThrow('Invalid credential environment variable name')
    const resolve = vi.fn(() => 'secret')
    expect(credentialProvider({ type: 'provider', resolve })).toBe(resolve)
  })
})
