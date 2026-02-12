import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  escapeHtmlAttr,
  escapeJs,
  escapeJson,
  escapeUrl,
  sanitizeUrl,
  detectXss,
  stripHtml,
  SafeHtml,
  safe,
  html,
  attr,
  sanitizeCss,
  CSPBuilder
} from './html-escape.js'

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
    )
  })

  it('should escape ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('should escape quotes', () => {
    expect(escapeHtml("it's \"quoted\"")).toBe("it&#x27;s &quot;quoted&quot;")
  })

  it('should handle null and undefined', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('should convert numbers and booleans to strings', () => {
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(true)).toBe('true')
  })

  it('should return empty string for safe input unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})

describe('escapeHtmlAttr', () => {
  it('should escape attribute values', () => {
    expect(escapeHtmlAttr('value "with" quotes')).toBe('value &quot;with&quot; quotes')
  })

  it('should escape newlines and tabs', () => {
    expect(escapeHtmlAttr('line1\nline2')).toContain('&#10;')
    expect(escapeHtmlAttr('col1\tcol2')).toContain('&#9;')
    expect(escapeHtmlAttr('line1\rline2')).toContain('&#13;')
  })

  it('should handle null and undefined', () => {
    expect(escapeHtmlAttr(null)).toBe('')
    expect(escapeHtmlAttr(undefined)).toBe('')
  })
})

describe('escapeJs', () => {
  it('should escape JS string special characters', () => {
    expect(escapeJs("it's")).toBe("it\\'s")
    expect(escapeJs('say "hi"')).toBe('say \\"hi\\"')
  })

  it('should escape angle brackets to prevent script injection', () => {
    expect(escapeJs('</script>')).toBe('\\x3C/script\\x3E')
  })

  it('should escape backslashes and control characters', () => {
    expect(escapeJs('a\\b')).toBe('a\\\\b')
    expect(escapeJs('a\nb')).toBe('a\\nb')
    expect(escapeJs('a\tb')).toBe('a\\tb')
  })

  it('should handle null and undefined', () => {
    expect(escapeJs(null)).toBe('')
    expect(escapeJs(undefined)).toBe('')
  })
})

describe('escapeJson', () => {
  it('should escape angle brackets in JSON', () => {
    const result = escapeJson({ message: '<script>' })
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).toContain('\\u003c')
    expect(result).toContain('\\u003e')
  })
})

describe('escapeUrl', () => {
  it('should encode URL parameters', () => {
    expect(escapeUrl('hello world')).toBe('hello%20world')
    expect(escapeUrl('a&b=c')).toBe('a%26b%3Dc')
  })

  it('should handle null and undefined', () => {
    expect(escapeUrl(null)).toBe('')
    expect(escapeUrl(undefined)).toBe('')
  })
})

describe('sanitizeUrl', () => {
  it('should allow safe URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
    expect(sanitizeUrl('/path/to/page')).toBe('/path/to/page')
  })

  it('should block javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('')
  })

  it('should block data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<h1>hi</h1>')).toBe('')
  })

  it('should block vbscript: and file: URLs', () => {
    expect(sanitizeUrl('vbscript:exec')).toBe('')
    expect(sanitizeUrl('file:///etc/passwd')).toBe('')
  })

  it('should handle undefined', () => {
    expect(sanitizeUrl(undefined)).toBe('')
  })
})

describe('detectXss', () => {
  it('should detect script tags', () => {
    expect(detectXss('<script>alert(1)</script>')).toBe(true)
  })

  it('should detect event handlers', () => {
    expect(detectXss('<img onerror=alert(1)>')).toBe(true)
    expect(detectXss('<div onmouseover=alert(1)>')).toBe(true)
  })

  it('should detect javascript: protocol', () => {
    expect(detectXss('javascript:alert(1)')).toBe(true)
  })

  it('should detect dangerous elements', () => {
    expect(detectXss('<iframe src="evil">')).toBe(true)
    expect(detectXss('<embed src="evil">')).toBe(true)
    expect(detectXss('<object data="evil">')).toBe(true)
  })

  it('should detect eval', () => {
    expect(detectXss('eval(userInput)')).toBe(true)
  })

  it('should return false for safe input', () => {
    expect(detectXss('Hello, world!')).toBe(false)
    expect(detectXss('Normal text with <b>bold</b>')).toBe(false)
  })
})

describe('stripHtml', () => {
  it('should remove all HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('should handle self-closing tags', () => {
    expect(stripHtml('line<br/>break')).toBe('linebreak')
  })
})

describe('SafeHtml and safe()', () => {
  it('should create SafeHtml instances', () => {
    const result = safe('<p>trusted</p>')
    expect(result).toBeInstanceOf(SafeHtml)
    expect(result.html).toBe('<p>trusted</p>')
  })

  it('should convert to string', () => {
    const result = safe('<p>test</p>')
    expect(result.toString()).toBe('<p>test</p>')
  })
})

describe('html template tag', () => {
  it('should escape interpolated values', () => {
    const userInput = '<script>alert(1)</script>'
    const result = html`<div>${userInput}</div>`
    expect(result.html).toContain('&lt;script&gt;')
    expect(result.html).not.toContain('<script>')
  })

  it('should not escape SafeHtml values', () => {
    const trusted = safe('<b>bold</b>')
    const result = html`<div>${trusted}</div>`
    expect(result.html).toContain('<b>bold</b>')
  })

  it('should return SafeHtml', () => {
    const result = html`<p>hello</p>`
    expect(result).toBeInstanceOf(SafeHtml)
  })
})

describe('attr', () => {
  it('should create attribute string', () => {
    expect(attr('class', 'btn')).toBe(' class="btn"')
  })

  it('should return empty for null/undefined/false', () => {
    expect(attr('disabled', null)).toBe('')
    expect(attr('disabled', undefined)).toBe('')
    expect(attr('disabled', false)).toBe('')
  })

  it('should return boolean attribute for true', () => {
    expect(attr('disabled', true)).toBe(' disabled')
  })

  it('should escape attribute values', () => {
    expect(attr('title', 'say "hi"')).toBe(' title="say &quot;hi&quot;"')
  })
})

describe('sanitizeCss', () => {
  it('should remove javascript: from CSS', () => {
    expect(sanitizeCss('background: javascript:alert(1)')).not.toContain('javascript:')
  })

  it('should remove expression()', () => {
    expect(sanitizeCss('width: expression(alert(1))')).not.toContain('expression(')
  })

  it('should remove @import', () => {
    expect(sanitizeCss('@import url("evil.css")')).not.toContain('@import')
  })
})

describe('CSPBuilder', () => {
  it('should build CSP header with defaults', () => {
    const csp = new CSPBuilder()
    const header = csp.build()
    expect(header).toContain("default-src 'self'")
    expect(header).toContain("script-src 'self'")
    expect(header).toContain("frame-ancestors 'none'")
  })

  it('should allow adding directives', () => {
    const csp = new CSPBuilder()
    csp.directive('connect-src', ["'self'", 'https://api.example.com'])
    const header = csp.build()
    expect(header).toContain('connect-src')
    expect(header).toContain('https://api.example.com')
  })

  it('should support allowInlineScripts', () => {
    const csp = new CSPBuilder()
    csp.allowInlineScripts()
    const header = csp.build()
    expect(header).toContain("'unsafe-inline'")
  })

  it('should support allowEval', () => {
    const csp = new CSPBuilder()
    csp.allowEval()
    const header = csp.build()
    expect(header).toContain("'unsafe-eval'")
  })

  it('should generate header object', () => {
    const csp = new CSPBuilder()
    const header = csp.toHeader()
    expect(header).toHaveProperty('Content-Security-Policy')
    expect(typeof header['Content-Security-Policy']).toBe('string')
  })
})
