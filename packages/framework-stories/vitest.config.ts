import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    root: __dirname,
    include: ['src/**/*.story.test.ts']
  }
})
