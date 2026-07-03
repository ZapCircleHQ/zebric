import { defineConfig } from 'vitest/config'
import { coverageConfig } from '../../vitest.shared'

export default defineConfig({
  test: {
    coverage: coverageConfig,
  },
})
