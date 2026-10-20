import { createWorkerHandler } from '@zebric/runtime-worker'
import blueprintToml from './blueprint.toml'

// Require explicit configuration locally and remotely. Never select development
// credentials from the hostname of an incoming request.
export default createWorkerHandler(env => {
  if (!env.BETTER_AUTH_URL || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('Set BETTER_AUTH_URL and a BETTER_AUTH_SECRET of at least 32 characters')
  }
  const origin = new URL(env.BETTER_AUTH_URL)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) {
    throw new Error('BETTER_AUTH_URL must use HTTPS outside local development')
  }
  return { blueprintContent: blueprintToml, blueprintFormat: 'toml' }
})
