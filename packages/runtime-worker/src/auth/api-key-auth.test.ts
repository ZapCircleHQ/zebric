import { describe, expect, it } from 'vitest'
import { WorkersApiKeyRegistry, agentHasScopes } from './api-key-auth.js'

const blueprint: any = {
  version: '0.3.0',
  project: { name: 'keys', version: '1.0.0', runtime: { min_version: '0.2.0' } },
  entities: [],
  pages: [],
  auth: {
    providers: [],
    apiKeys: [{
      name: 'automation',
      keyEnv: 'AUTOMATION_KEY',
      agentId: 'agent-1',
      credentialId: 'credential-1',
      roles: ['operator'],
      scopes: ['entity.item.list'],
    }],
  },
}

describe('WorkersApiKeyRegistry', () => {
  it('resolves Worker secret bindings into scoped agent sessions', async () => {
    const registry = new WorkersApiKeyRegistry(blueprint, { AUTOMATION_KEY: 'secret-value' })
    const session = await registry.resolve('secret-value')

    expect(session?.actor).toMatchObject({
      type: 'agent',
      id: 'agent-1',
      credentialId: 'credential-1',
      roles: ['operator'],
      scopes: ['entity.item.list'],
    })
    expect(agentHasScopes(session, ['entity.item.list'])).toBe(true)
    expect(agentHasScopes(session, ['entity.item.create'])).toBe(false)
  })

  it('rejects unknown bearer values', async () => {
    const registry = new WorkersApiKeyRegistry(blueprint, { AUTOMATION_KEY: 'secret-value' })
    expect(await registry.resolve('wrong-value')).toBeNull()
  })
})
