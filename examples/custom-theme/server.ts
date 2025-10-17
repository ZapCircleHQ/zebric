/**
 * Custom Theme Demo Server
 *
 * Demonstrates how to use a custom theme with ZBL Engine
 */

import { ZebricEngine } from '@zebric/runtime'
import { brandTheme } from './brand-theme.js'

const engine = new ZebricEngine({
  blueprintPath: './blueprint.json',
  port: 3000,
  host: 'localhost',
  theme: brandTheme, // ← Pass custom theme here
  dev: {
    hotReload: true,
    logLevel: 'info',
    dbPath: './data/dev.db'
  }
})

await engine.start()

console.log('🎨 Custom theme loaded: ' + brandTheme.name)
console.log('💜 Visit http://localhost:3000 to see the branded UI!')
