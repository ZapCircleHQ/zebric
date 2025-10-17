/**
 * Unit tests for HTML escaping and CSP utilities
 */

import { describe, it, expect } from 'vitest'
import { escapeHtml, html, safe, CSPBuilder } from './html-escape.js'

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
    )
  })

  it('should escape ampersands', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
  })

  it('should escape single quotes', () => {
    expect(escapeHtml("It's a test")).toBe('It&#x27;s a test')
  })

  it('should handle empty strings', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('should handle strings without special characters', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World')
  })

  it('should escape all special characters in one string', () => {
    expect(escapeHtml('<div class="test">Tom & Jerry\'s "Show"</div>')).toBe(
      '&lt;div class=&quot;test&quot;&gt;Tom &amp; Jerry&#x27;s &quot;Show&quot;&lt;&#x2F;div&gt;'
    )
  })
})

describe('html template tag', () => {
  it('should escape interpolated values', () => {
    const userInput = '<script>alert("xss")</script>'
    const result = html`<div>${userInput}</div>`
    expect(result.toString()).toBe('<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;</div>')
  })

  it('should handle multiple interpolations', () => {
    const name = '<Bob>'
    const message = '"Hello"'
    const result = html`<p>User: ${name}, Message: ${message}</p>`
    expect(result.toString()).toContain('&lt;Bob&gt;')
    expect(result.toString()).toContain('&quot;Hello&quot;')
  })

  it('should not escape safe() wrapped values', () => {
    const trustedHtml = '<strong>Bold</strong>'
    const result = html`<div>${safe(trustedHtml)}</div>`
    expect(result.toString()).toBe('<div><strong>Bold</strong></div>')
  })

  it('should handle nested html calls', () => {
    const inner = html`<span>test</span>`
    const outer = html`<div>${inner}</div>`
    expect(outer.toString()).toBe('<div><span>test</span></div>')
  })

  it('should handle empty interpolations', () => {
    const result = html`<div>${''}</div>`
    expect(result.toString()).toBe('<div></div>')
  })

  it('should handle numbers', () => {
    const count = 42
    const result = html`<div>Count: ${count}</div>`
    expect(result.toString()).toBe('<div>Count: 42</div>')
  })

  it('should handle booleans', () => {
    const isActive = true
    const result = html`<div>Active: ${isActive}</div>`
    expect(result.toString()).toBe('<div>Active: true</div>')
  })
})

describe('safe', () => {
  it('should create SafeHtml instance', () => {
    const safemark = safe('<div>test</div>')
    expect(safemark).toBeInstanceOf(Object)
    expect(safemark.toString()).toBe('<div>test</div>')
    expect(safemark.html).toBe('<div>test</div>')
  })

  it('should handle empty strings', () => {
    const safemark = safe('')
    expect(safemark.toString()).toBe('')
    expect(safemark.html).toBe('')
  })

  it('should allow safe HTML in template tags', () => {
    const safeContent = safe('<b>Bold</b>')
    const result = html`<div>${safeContent}</div>`
    expect(result.toString()).toBe('<div><b>Bold</b></div>')
  })
})

describe('CSPBuilder', () => {
  it('should create CSP with default secure directives', () => {
    const csp = new CSPBuilder().build()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it('should allow custom directives', () => {
    const csp = new CSPBuilder()
      .directive('script-src', ["'self'", "'unsafe-inline'"])
      .build()
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
  })

  it('should handle multiple directives', () => {
    const csp = new CSPBuilder()
      .directive('img-src', ["'self'", 'data:', 'https:'])
      .directive('font-src', ["'self'", 'https://fonts.gstatic.com'])
      .build()
    expect(csp).toContain("img-src 'self' data: https:")
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com")
  })

  it('should return CSP header object', () => {
    const header = new CSPBuilder().toHeader()
    expect(header).toHaveProperty('Content-Security-Policy')
    expect(typeof header['Content-Security-Policy']).toBe('string')
  })

  it('should allow overriding default directives', () => {
    const csp = new CSPBuilder()
      .directive('default-src', ["'none'"])
      .build()
    expect(csp).toContain("default-src 'none'")
  })

  it('should allow adding custom directives', () => {
    const csp = new CSPBuilder()
      .directive('worker-src', ["'self'"])
      .build()
    expect(csp).toContain("worker-src 'self'")
  })

  it('should handle script-src modifications', () => {
    const csp = new CSPBuilder()
      .directive('script-src', ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'])
      .build()
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com")
  })
})
