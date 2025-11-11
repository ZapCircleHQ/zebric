/**
 * Zebric CloudFlare Workers Starter
 *
 * This is the only file you need - just modify blueprint.toml!
 */

import { ZebricWorkersEngine } from '@zebric/runtime-worker'
import type { WorkersEnv } from '@zebric/runtime-worker'
import blueprintToml from './blueprint.toml'

export default {
  async fetch(request: Request, env: WorkersEnv, ctx: ExecutionContext): Promise<Response> {
    const engine = new ZebricWorkersEngine({
      env,
      blueprintContent: blueprintToml,
      blueprintFormat: 'toml'
    })

    return engine.fetch(request)
  }
}
