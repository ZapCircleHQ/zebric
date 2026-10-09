import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['dot'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.PLAYWRIGHT_VIDEO === 'off' ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
