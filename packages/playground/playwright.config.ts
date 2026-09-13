import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)
const port = 4373

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['dot'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite preview --port ${port} --host 127.0.0.1 --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
