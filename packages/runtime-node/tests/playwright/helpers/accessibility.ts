import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect } from '../fixtures/zebric-fixtures.js'

export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  expect(formatViolations(results.violations)).toEqual([])
}

function formatViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']): string[] {
  return violations.map((violation) => {
    const targets = violation.nodes
      .flatMap((node) => node.target)
      .slice(0, 5)
      .join(', ')
    return `${violation.id}: ${violation.help} (${targets})`
  })
}
