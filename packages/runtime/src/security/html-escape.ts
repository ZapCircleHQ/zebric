/**
 * HTML Escaping & XSS Protection
 *
 * Provides secure HTML encoding to prevent XSS attacks.
 */

// HTML entity map for escaping
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
}

const HTML_ENTITIES_REGEX = /[&<>"'\/]/g

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(unsafe: string | number | boolean | null | undefined): string {
  if (unsafe === null || unsafe === undefined) {
    return ''
  }

  const str = String(unsafe)
  return str.replace(HTML_ENTITIES_REGEX, char => HTML_ENTITIES[char] || char)
}

/**
 * Escape HTML attribute value
 */
export function escapeHtmlAttr(unsafe: string | number | boolean | null | undefined): string {
  if (unsafe === null || unsafe === undefined) {
    return ''
  }

  const str = String(unsafe)
  // Attributes need more aggressive escaping
  return str
    .replace(HTML_ENTITIES_REGEX, char => HTML_ENTITIES[char] || char)
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;')
}

/**
 * Escape for use in JavaScript strings
 */
export function escapeJs(unsafe: string | number | boolean | null | undefined): string {
  if (unsafe === null || unsafe === undefined) {
    return ''
  }

  const str = String(unsafe)
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/</g, '\\x3C') // Prevent </script> tag closing
    .replace(/>/g, '\\x3E')
}

/**
 * Escape for use in JSON (already safe, but validate)
 */
export function escapeJson(obj: any): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\//g, '\\/')
}

/**
 * Escape URL parameter
 */
export function escapeUrl(unsafe: string | number | boolean | null | undefined): string {
  if (unsafe === null || unsafe === undefined) {
    return ''
  }

  return encodeURIComponent(String(unsafe))
}

/**
 * Sanitize URL to prevent javascript: and data: URLs
 */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) {
    return ''
  }

  const trimmed = url.trim().toLowerCase()

  // Block dangerous protocols
  const dangerous = [
    'javascript:',
    'data:',
    'vbscript:',
    'file:',
    'about:',
  ]

  for (const proto of dangerous) {
    if (trimmed.startsWith(proto)) {
      return ''
    }
  }

  return url
}

/**
 * Check if string contains potential XSS
 */
export function detectXss(input: string): boolean {
  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // Event handlers
    /<iframe/gi,
    /<embed/gi,
    /<object/gi,
    /eval\(/gi,
    /expression\(/gi,
  ]

  return xssPatterns.some(pattern => pattern.test(input))
}

/**
 * Strip all HTML tags (aggressive sanitization)
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

/**
 * SafeHtml wrapper class to mark strings as safe HTML (already escaped/sanitized)
 */
export class SafeHtml {
  constructor(public readonly html: string) {}

  toString(): string {
    return this.html
  }
}

/**
 * Create a SafeHtml instance (for marking pre-escaped HTML as safe)
 */
export function safe(html: string): SafeHtml {
  return new SafeHtml(html)
}

/**
 * Template literal tag for safe HTML
 * Usage: html`<div>${unsafeVariable}</div>`
 *
 * Note: Values that are SafeHtml instances will NOT be escaped,
 * allowing composition of HTML fragments without double-escaping.
 */
export function html(strings: TemplateStringsArray, ...values: any[]): SafeHtml {
  let result = strings[0]

  for (let i = 0; i < values.length; i++) {
    const value = values[i]

    // Don't escape SafeHtml instances
    if (value instanceof SafeHtml) {
      result += value.html
    } else {
      result += escapeHtml(value)
    }

    result += strings[i + 1]
  }

  return new SafeHtml(result)
}

/**
 * Create safe HTML attributes
 */
export function attr(name: string, value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === false) {
    return ''
  }

  if (value === true) {
    return ` ${name}`
  }

  return ` ${name}="${escapeHtmlAttr(value)}"`
}

/**
 * Validate and sanitize CSS value
 */
export function sanitizeCss(css: string): string {
  // Remove potentially dangerous CSS
  return css
    .replace(/javascript:/gi, '')
    .replace(/expression\(/gi, '')
    .replace(/import\s+/gi, '')
    .replace(/@import/gi, '')
    .replace(/url\(/gi, '')
}

/**
 * Content Security Policy builder
 */
export class CSPBuilder {
  private directives: Map<string, string[]> = new Map()

  constructor() {
    // Secure defaults
    this.directive('default-src', ["'self'"])
    this.directive('script-src', ["'self'"])
    this.directive('style-src', ["'self'", "'unsafe-inline'"]) // Allow inline styles
    this.directive('img-src', ["'self'", 'data:', 'https:'])
    this.directive('font-src', ["'self'"])
    this.directive('connect-src', ["'self'"])
    this.directive('frame-ancestors', ["'none'"])
    this.directive('base-uri', ["'self'"])
    this.directive('form-action', ["'self'"])
  }

  /**
   * Add a CSP directive
   */
  directive(name: string, values: string[]): this {
    this.directives.set(name, values)
    return this
  }

  /**
   * Allow inline scripts (reduces security - use sparingly)
   */
  allowInlineScripts(): this {
    const current = this.directives.get('script-src') || []
    if (!current.includes("'unsafe-inline'")) {
      current.push("'unsafe-inline'")
      this.directives.set('script-src', current)
    }
    return this
  }

  /**
   * Allow eval() (dangerous - avoid if possible)
   */
  allowEval(): this {
    const current = this.directives.get('script-src') || []
    if (!current.includes("'unsafe-eval'")) {
      current.push("'unsafe-eval'")
      this.directives.set('script-src', current)
    }
    return this
  }

  /**
   * Build CSP header value
   */
  build(): string {
    const parts: string[] = []

    for (const [directive, values] of this.directives) {
      parts.push(`${directive} ${values.join(' ')}`)
    }

    return parts.join('; ')
  }

  /**
   * Get as HTTP header object
   */
  toHeader(): { 'Content-Security-Policy': string } {
    return {
      'Content-Security-Policy': this.build(),
    }
  }
}
