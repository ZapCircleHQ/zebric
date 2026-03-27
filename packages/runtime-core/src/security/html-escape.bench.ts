/**
 * HTML Escape Benchmarks
 *
 * Measures escaping cost — called for every user-generated value in every render.
 */

import { bench, describe } from 'vitest'
import { escapeHtml, escapeHtmlAttr } from './html-escape.js'

const cleanShort = 'Hello World'
const cleanLong = 'The quick brown fox jumps over the lazy dog. '.repeat(20)
const dirtyShort = '<script>alert("xss")</script>'
const dirtyLong = '<img src=x onerror="alert(1)"> & <b>bold</b> & it\'s "quoted"'.repeat(20)
const mixedTypical = 'User posted: "Hello & <goodbye>" on their profile'

describe('escapeHtml', () => {
  bench('clean short string', () => {
    escapeHtml(cleanShort)
  })

  bench('clean long string (no escaping needed)', () => {
    escapeHtml(cleanLong)
  })

  bench('dirty short string (XSS attempt)', () => {
    escapeHtml(dirtyShort)
  })

  bench('dirty long string (many replacements)', () => {
    escapeHtml(dirtyLong)
  })

  bench('typical user content', () => {
    escapeHtml(mixedTypical)
  })

  bench('null value', () => {
    escapeHtml(null)
  })

  bench('number value', () => {
    escapeHtml(42)
  })
})

describe('escapeHtmlAttr', () => {
  bench('clean attribute value', () => {
    escapeHtmlAttr('my-css-class another-class')
  })

  bench('dirty attribute value', () => {
    escapeHtmlAttr('" onmouseover="alert(1)')
  })

  bench('multiline attribute value', () => {
    escapeHtmlAttr('line one\nline two\ttabbed')
  })
})
