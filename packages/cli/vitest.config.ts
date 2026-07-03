import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { coverageConfig } from '../../vitest.shared'

export default defineConfig({
  test: {
    coverage: coverageConfig,
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
    ],
  },
  resolve: {
    alias: {
      '@zebric/runtime-node': resolve(__dirname, '../runtime-node/src/index.ts'),
    },
  },
})
