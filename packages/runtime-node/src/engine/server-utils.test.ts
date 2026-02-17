import { describe, it, expect } from 'vitest'
import {
  normalizeActionBody,
  isSafeRedirect,
  resolveActionRedirect,
} from './server-utils.js'

describe('pagination param parsing', () => {
  it('clamps limit to max 1000', () => {
    const limitParam = parseInt('5000', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(1000)
  })

  it('defaults limit to 100 when not provided', () => {
    const limitParam = parseInt('', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(100)
  })

  it('uses provided limit when valid', () => {
    const limitParam = parseInt('50', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(50)
  })

  it('defaults limit to 100 for negative values', () => {
    const limitParam = parseInt('-5', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(100)
  })

  it('defaults limit to 100 for zero', () => {
    const limitParam = parseInt('0', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(100)
  })

  it('returns undefined offset when not provided', () => {
    const offsetParam = parseInt('', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBeUndefined()
  })

  it('returns offset when valid', () => {
    const offsetParam = parseInt('20', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBe(20)
  })

  it('allows offset of 0', () => {
    const offsetParam = parseInt('0', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBe(0)
  })

  it('returns undefined offset for negative values', () => {
    const offsetParam = parseInt('-10', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBeUndefined()
  })
})

describe('normalizeActionBody', () => {
  it('does not decode HTML entities', () => {
    const input = {
      title: '&lt;script&gt;alert(1)&lt;/script&gt;',
      status: '&amp;active',
      clean: 'hello world',
    }
    const result = normalizeActionBody(input)

    // Values must pass through untouched — no decoding
    expect(result.title).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(result.status).toBe('&amp;active')
    expect(result.clean).toBe('hello world')
  })

  it('handles empty and null input', () => {
    expect(normalizeActionBody({})).toEqual({})
    expect(normalizeActionBody(null as any)).toEqual({})
    expect(normalizeActionBody(undefined as any)).toEqual({})
  })
})

describe('isSafeRedirect', () => {
  it('allows relative paths', () => {
    expect(isSafeRedirect('/')).toBe(true)
    expect(isSafeRedirect('/issues')).toBe(true)
    expect(isSafeRedirect('/issues/123')).toBe(true)
    expect(isSafeRedirect('/issues?status=open')).toBe(true)
  })

  it('rejects absolute URLs', () => {
    expect(isSafeRedirect('https://evil.com')).toBe(false)
    expect(isSafeRedirect('http://evil.com/phish')).toBe(false)
  })

  it('rejects protocol-relative URLs', () => {
    expect(isSafeRedirect('//evil.com')).toBe(false)
    expect(isSafeRedirect('//evil.com/path')).toBe(false)
  })

  it('rejects javascript: and data: schemes', () => {
    expect(isSafeRedirect('javascript:alert(1)')).toBe(false)
    expect(isSafeRedirect('data:text/html,<h1>hi</h1>')).toBe(false)
  })

  it('rejects empty and null values', () => {
    expect(isSafeRedirect('')).toBe(false)
    expect(isSafeRedirect(undefined as any)).toBe(false)
    expect(isSafeRedirect(null as any)).toBe(false)
  })
})

describe('resolveActionRedirect', () => {
  it('falls back to / for unsafe values', () => {
    expect(resolveActionRedirect('https://evil.com')).toBe('/')
    expect(resolveActionRedirect('//evil.com')).toBe('/')
    expect(resolveActionRedirect(undefined, 'https://evil.com')).toBe('/')
    expect(resolveActionRedirect(undefined, undefined)).toBe('/')
  })

  it('uses safe provided value', () => {
    expect(resolveActionRedirect('/issues/123')).toBe('/issues/123')
  })

  it('falls back to safe referer', () => {
    expect(resolveActionRedirect(undefined, '/board')).toBe('/board')
  })
})
