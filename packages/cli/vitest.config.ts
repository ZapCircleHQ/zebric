import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
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
