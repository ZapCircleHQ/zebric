import { defineConfig } from 'vitest/config'
import { coverageConfig } from '../../vitest.shared'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: coverageConfig,
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache'
    ]
  },
  resolve: {
    alias: {
      '@zebric/runtime-core': new URL('../runtime-core/src/index.ts', import.meta.url).pathname,
      '@zebric/runtime-worker': new URL('./src/index.ts', import.meta.url).pathname
    }
  }
})
