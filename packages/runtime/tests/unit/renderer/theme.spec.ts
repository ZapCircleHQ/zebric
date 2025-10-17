import { describe, it, expect } from 'vitest'
import { defaultTheme, darkTheme, type Theme } from '../../../src/renderer/theme.js'

describe('Theme System', () => {
  describe('defaultTheme', () => {
    it('should have all required properties', () => {
      expect(defaultTheme.name).toBe('default')
      expect(defaultTheme.body).toBeDefined()
      expect(defaultTheme.container).toBeDefined()
      expect(defaultTheme.heading1).toBeDefined()
      expect(defaultTheme.buttonPrimary).toBeDefined()
      expect(defaultTheme.input).toBeDefined()
      expect(defaultTheme.table).toBeDefined()
    })

    it('should use light colors', () => {
      expect(defaultTheme.body).toContain('gray-50')
      expect(defaultTheme.body).toContain('gray-900')
    })

    it('should have consistent button styling', () => {
      expect(defaultTheme.buttonPrimary).toContain('bg-blue')
      expect(defaultTheme.buttonSecondary).toContain('border')
    })
  })

  describe('darkTheme', () => {
    it('should extend defaultTheme', () => {
      expect(darkTheme.name).toBe('dark')
      // Should have same structure as default
      expect(darkTheme.heading1).toBeDefined()
      expect(darkTheme.buttonPrimary).toBeDefined()
    })

    it('should use dark colors', () => {
      expect(darkTheme.body).toContain('gray-900')
      expect(darkTheme.card).toContain('gray-800')
    })

    it('should override specific properties', () => {
      expect(darkTheme.body).not.toBe(defaultTheme.body)
      expect(darkTheme.card).not.toBe(defaultTheme.card)
    })
  })

  describe('custom theme validation', () => {
    it('should allow creating custom themes', () => {
      const customTheme: Theme = {
        ...defaultTheme,
        name: 'custom',
        body: 'bg-purple-50',
        buttonPrimary: 'bg-purple-600'
      }

      expect(customTheme.name).toBe('custom')
      expect(customTheme.body).toBe('bg-purple-50')
      expect(customTheme.buttonPrimary).toBe('bg-purple-600')
    })

    it('should support custom CSS', () => {
      const themeWithCSS: Theme = {
        ...defaultTheme,
        name: 'custom',
        customCSS: '@keyframes slide { from { left: 0 } to { left: 100% } }'
      }

      expect(themeWithCSS.customCSS).toContain('@keyframes')
    })
  })

  describe('theme consistency', () => {
    it('should have matching component styles', () => {
      // All button styles should follow same pattern
      expect(defaultTheme.buttonPrimary).toContain('px-')
      expect(defaultTheme.buttonPrimary).toContain('py-')
      expect(defaultTheme.buttonSecondary).toContain('px-')
      expect(defaultTheme.buttonSecondary).toContain('py-')
    })

    it('should have consistent spacing', () => {
      expect(defaultTheme.heading1).toContain('mb-')
      expect(defaultTheme.heading2).toContain('mb-')
      expect(defaultTheme.heading3).toContain('mb-')
    })
  })
})
