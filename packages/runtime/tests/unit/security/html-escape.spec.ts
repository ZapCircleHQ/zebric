import { describe, it, expect } from 'vitest'
import { escapeHtml, escapeHtmlAttr, escapeJs, detectXss, html, safe } from '../../../src/security/html-escape.js'

describe('HTML Escaping', () => {
  describe('escapeHtml', () => {
    it('should escape basic HTML characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
      )
    })

    it('should escape ampersands', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B')
    })

    it('should escape quotes', () => {
      expect(escapeHtml('She said "hello"')).toBe('She said &quot;hello&quot;')
    })

    it('should escape apostrophes', () => {
      expect(escapeHtml("It's mine")).toBe('It&#x27;s mine')
    })

    it('should escape forward slashes', () => {
      expect(escapeHtml('</script>')).toBe('&lt;&#x2F;script&gt;')
    })

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('should handle strings with no special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World')
    })
  })

  describe('escapeHtmlAttr', () => {
    it('should escape attribute values', () => {
      expect(escapeHtmlAttr('test"value')).toBe('test&quot;value')
    })

    it('should handle empty attributes', () => {
      expect(escapeHtmlAttr('')).toBe('')
    })
  })

  describe('escapeJs', () => {
    it('should escape JavaScript strings', () => {
      expect(escapeJs('"; alert("xss"); "')).toContain('\\')
    })

    it('should escape backslashes', () => {
      expect(escapeJs('C:\\Users\\test')).toContain('\\\\')
    })

    it('should handle newlines', () => {
      expect(escapeJs('line1\nline2')).toContain('\\n')
    })
  })

  describe('detectXss', () => {
    it('should detect script tags', () => {
      expect(detectXss('<script>alert(1)</script>')).toBe(true)
    })

    it('should detect onclick handlers', () => {
      expect(detectXss('<img onclick="alert(1)">')).toBe(true)
    })

    it('should detect onerror handlers', () => {
      expect(detectXss('<img src=x onerror="alert(1)">')).toBe(true)
    })

    it('should detect javascript: protocol', () => {
      expect(detectXss('<a href="javascript:alert(1)">link</a>')).toBe(true)
    })

    it('should detect data: protocol', () => {
      expect(detectXss('<iframe src="data:text/html,<script>alert(1)</script>">')).toBe(true)
    })

    it('should allow safe content', () => {
      expect(detectXss('Hello <b>World</b>')).toBe(false)
    })

    it('should allow empty strings', () => {
      expect(detectXss('')).toBe(false)
    })
  })

  describe('html template tag', () => {
    it('should escape interpolated values', () => {
      const userInput = '<script>alert("xss")</script>'
      const result = html`<div>${userInput}</div>`
      expect(result.html).toContain('&lt;script&gt;')
      expect(result.html).not.toContain('<script>')
    })

    it('should handle multiple interpolations', () => {
      const name = '<script>xss</script>'
      const email = 'test@example.com'
      const result = html`<p>${name}: ${email}</p>`
      expect(result.html).toContain('&lt;script&gt;')
      expect(result.html).toContain('test@example.com')
    })

    it('should preserve safe HTML from safe()', () => {
      const safeContent = safe('<b>bold</b>')
      const result = html`<div>${safeContent}</div>`
      expect(result.html).toBe('<div><b>bold</b></div>')
    })

    it('should handle mixed safe and unsafe content', () => {
      const unsafe = '<script>xss</script>'
      const safeContent = safe('<b>safe</b>')
      const result = html`<div>${unsafe} ${safeContent}</div>`
      expect(result.html).toContain('&lt;script&gt;')
      expect(result.html).toContain('<b>safe</b>')
    })
  })

  describe('XSS Attack Vectors', () => {
    it('should block SVG XSS', () => {
      const svg = '<svg onload="alert(1)">'
      expect(detectXss(svg)).toBe(true)
    })

    it('should block IMG XSS', () => {
      const img = '<img src=x onerror="alert(1)">'
      expect(detectXss(img)).toBe(true)
    })

    it('should block iframe XSS', () => {
      const iframe = '<iframe src="javascript:alert(1)">'
      expect(detectXss(iframe)).toBe(true)
    })

    it('should block form action XSS', () => {
      const form = '<form action="javascript:alert(1)">'
      expect(detectXss(form)).toBe(true)
    })

    it('should block event handler variations', () => {
      expect(detectXss('<div onmouseover="alert(1)">')).toBe(true)
      expect(detectXss('<div onload="alert(1)">')).toBe(true)
      expect(detectXss('<div onfocus="alert(1)">')).toBe(true)
    })
  })
})
