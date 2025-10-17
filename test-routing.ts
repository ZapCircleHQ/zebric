#!/usr/bin/env node
/**
 * Test script to verify HTTP routing
 */

import { ZebricEngine } from './packages/runtime/dist/index.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  // Create engine instance
  const engine = new ZebricEngine({
    blueprintPath: path.join(__dirname, 'examples/blog/blueprint.json'),
    port: 3000,
    host: 'localhost',
    dev: {
      hotReload: true,
      logLevel: 'debug'
    }
  })

  // Start engine
  await engine.start()

  console.log('\n🧪 Testing Routes:')
  console.log('  GET  /')
  console.log('  GET  /posts')
  console.log('  GET  /posts/:id')
  console.log('  GET  /users/:id')
  console.log('  POST /posts/new')
  console.log('  PUT  /posts/:id/edit')
  console.log('  DELETE /posts/:id/delete')
  console.log('\nPress Ctrl+C to stop\n')
}

main().catch(console.error)
