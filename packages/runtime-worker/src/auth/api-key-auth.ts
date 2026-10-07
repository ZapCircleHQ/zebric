import type {
  ApiKeyConfig,
  AuthenticatedActor,
  Blueprint,
  UserSession,
} from '@zebric/runtime-core'

export interface WorkersApiKeyCredential {
  name: string
  agentId: string
  credentialId: string
  displayName: string
  roles: string[]
  scopes: string[]
  constraints?: Record<string, string[]>
}

/**
 * Worker-native API-key registry. Only SHA-256 verifiers are retained after
 * initialization; plaintext bindings are never stored in the registry.
 */
export class WorkersApiKeyRegistry {
  private ready: Promise<Map<string, WorkersApiKeyCredential>>

  constructor(blueprint: Blueprint, env: object) {
    const values = env as Record<string, unknown>
    const configured = (blueprint.auth?.apiKeys ?? []).flatMap(config => {
      const token = values[config.keyEnv]
      if (typeof token !== 'string' || token.length === 0) {
        console.warn(`API key "${config.name}": Worker binding ${config.keyEnv} is not set, skipping`)
        return []
      }
      return [{ token, credential: this.toCredential(config) }]
    })

    this.ready = Promise.all(configured.map(async ({ token, credential }) =>
      [await apiKeyVerifier(token), credential] as const
    )).then(entries => new Map(entries))
  }

  async resolve(token: string): Promise<UserSession | null> {
    if (!token) return null
    const credential = (await this.ready).get(await apiKeyVerifier(token))
    if (!credential) return null

    const actor: AuthenticatedActor = {
      type: 'agent',
      id: credential.agentId,
      credentialId: credential.credentialId,
      displayName: credential.displayName,
      roles: [...credential.roles],
      scopes: [...credential.scopes],
      ...(credential.constraints ? { constraints: credential.constraints } : {}),
    }
    return {
      id: `apikey-${credential.credentialId}`,
      userId: credential.agentId,
      user: {
        id: credential.agentId,
        email: '',
        name: credential.displayName,
        role: credential.roles[0],
        roles: actor.roles,
      },
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      actor,
    }
  }

  async resolveRequest(request: Request): Promise<UserSession | null> {
    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.toLowerCase().startsWith('bearer ')) return null
    return this.resolve(authorization.slice(7).trim())
  }

  private toCredential(config: ApiKeyConfig): WorkersApiKeyCredential {
    return {
      name: config.name,
      agentId: config.agentId ?? config.name,
      credentialId: config.credentialId ?? config.name,
      displayName: config.displayName ?? config.name,
      roles: [...(config.roles ?? [])],
      scopes: [...(config.scopes ?? [])],
      ...(config.constraints ? { constraints: config.constraints } : {}),
    }
  }
}

export function agentHasScopes(session: UserSession | null | undefined, required: string[]): boolean {
  if (session?.actor?.type !== 'agent' || required.length === 0) return true
  const granted = new Set(session.actor.scopes ?? [])
  return granted.has('*') || required.every(scope => granted.has(scope))
}

async function apiKeyVerifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const bytes = Array.from(new Uint8Array(digest), byte => String.fromCharCode(byte)).join('')
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
