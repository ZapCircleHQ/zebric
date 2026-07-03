export const coverageConfig = {
  provider: 'v8',
  all: true,
  include: ['src/**/*.{ts,tsx}'],
  exclude: [
    '**/*.test.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    '**/*.bench.ts',
    '**/*.d.ts',
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    'src/**/*.types.ts',
    'src/**/types.ts',
    'src/renderer/generated/**',
    'src/renderer/styles/tailwind.generated.ts',
  ],
  reporter: ['text', 'json', 'json-summary', 'lcov'],
} as const
