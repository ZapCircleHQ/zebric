/**
 * Zebric Cloudflare Workers Starter
 *
 * This is the only file you need - just modify blueprint.toml!
 */

import { createWorkerHandler } from '@zebric/runtime-worker'
import blueprintToml from './blueprint.toml'

export default createWorkerHandler({
  blueprintContent: blueprintToml,
  blueprintFormat: 'toml',
})
