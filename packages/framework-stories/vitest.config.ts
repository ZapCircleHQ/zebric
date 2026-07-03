import { defineConfig } from 'vitest/config'
import { coverageConfig } from '../../vitest.shared'

export default defineConfig({
  test: {
    environment: 'node',
    root: __dirname,
    coverage: coverageConfig,
    include: ['src/**/*.story.test.ts']
  }
})
