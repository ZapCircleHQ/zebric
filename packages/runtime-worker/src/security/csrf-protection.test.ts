import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkersCSRFProtection } from './csrf-protection.js'

function makeSessionManager(csrfToken: string | null = 'valid-token') {
  return {
    getCSRFToken: vi.fn().mockResolvedValue(csrfToken),
  } as any
}

function makeRequest(
  method: string,
  options: {
    headers?: Record<string, string>
    body?: string
    contentType?: string
  } = {}
): Request {
  const headers: Record<string, string> = { ...options.headers }
  if (options.contentType) {
    headers['content-type'] = options.contentType
  }
  return new Request('https://example.com/api/action', {
    method,
    headers,
    body: options.body,
  })
}

describe('WorkersCSRFProtection', () => {
  describe('constructor defaults', () => {
    it('uses default cookie, header, and form field names', () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      // Verify defaults by calling createCSRFCookie
      const cookie = protection.createCSRFCookie('tok')
      expect(cookie).toContain('csrf-token=tok')
    })

    it('accepts custom names', () => {
      const protection = new WorkersCSRFProtection({
        sessionManager: makeSessionManager(),
        cookieName: 'my-csrf',
        headerName: 'x-my-csrf',
        formFieldName: '_my_csrf',
      })
      const cookie = protection.createCSRFCookie('tok')
      expect(cookie).toContain('my-csrf=tok')
    })
  })

  describe('getToken', () => {
    it('delegates to sessionManager.getCSRFToken', async () => {
      const sm = makeSessionManager('tok-abc')
      const protection = new WorkersCSRFProtection({ sessionManager: sm })
      const result = await protection.getToken('sess-1')
      expect(result).toBe('tok-abc')
      expect(sm.getCSRFToken).toHaveBeenCalledWith('sess-1')
    })

    it('returns null when session has no CSRF token', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager(null) })
      expect(await protection.getToken('sess-x')).toBeNull()
    })
  })

  describe('validate', () => {
    it('returns true for GET without checking token', async () => {
      const sm = makeSessionManager(null)
      const protection = new WorkersCSRFProtection({ sessionManager: sm })
      const req = makeRequest('GET')
      expect(await protection.validate(req, 'sess-1')).toBe(true)
      expect(sm.getCSRFToken).not.toHaveBeenCalled()
    })

    it('returns true for HEAD', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager(null) })
      expect(await protection.validate(makeRequest('HEAD'), 'sess-1')).toBe(true)
    })

    it('returns true for OPTIONS', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager(null) })
      expect(await protection.validate(makeRequest('OPTIONS'), 'sess-1')).toBe(true)
    })

    it('returns false for POST when no expected token in session', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager(null) })
      const req = makeRequest('POST', { headers: { 'x-csrf-token': 'anything' } })
      expect(await protection.validate(req, 'sess-1')).toBe(false)
    })

    it('returns true for POST with matching header token', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('secret') })
      const req = makeRequest('POST', { headers: { 'x-csrf-token': 'secret' } })
      expect(await protection.validate(req, 'sess-1')).toBe(true)
    })

    it('returns false for POST with mismatched header token', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('secret') })
      const req = makeRequest('POST', { headers: { 'x-csrf-token': 'wrong' } })
      expect(await protection.validate(req, 'sess-1')).toBe(false)
    })

    it('returns false for POST with different-length token (timing-safe path)', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('longtoken') })
      const req = makeRequest('POST', { headers: { 'x-csrf-token': 'short' } })
      expect(await protection.validate(req, 'sess-1')).toBe(false)
    })

    it('falls back to cookie when no header token', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('secret') })
      const req = makeRequest('POST', { headers: { cookie: 'csrf-token=secret' } })
      expect(await protection.validate(req, 'sess-1')).toBe(true)
    })

    it('reads token from form body (urlencoded)', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('formtok') })
      const body = '_csrf=formtok'
      const req = makeRequest('POST', {
        body,
        contentType: 'application/x-www-form-urlencoded',
      })
      expect(await protection.validate(req, 'sess-1')).toBe(true)
    })

    it('returns false when form body has wrong token', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('formtok') })
      const body = '_csrf=badtok'
      const req = makeRequest('POST', {
        body,
        contentType: 'application/x-www-form-urlencoded',
      })
      expect(await protection.validate(req, 'sess-1')).toBe(false)
    })

    it('returns false for POST with no submitted token at all', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('secret') })
      const req = makeRequest('POST', { contentType: 'application/json', body: '{}' })
      expect(await protection.validate(req, 'sess-1')).toBe(false)
    })

    it('handles PUT and DELETE methods', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('tok') })
      const putReq = makeRequest('PUT', { headers: { 'x-csrf-token': 'tok' } })
      const deleteReq = makeRequest('DELETE', { headers: { 'x-csrf-token': 'tok' } })
      expect(await protection.validate(putReq, 'sess-1')).toBe(true)
      expect(await protection.validate(deleteReq, 'sess-1')).toBe(true)
    })
  })

  describe('createCSRFCookie', () => {
    it('creates a cookie with httpOnly=false so clients can read it', () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      const cookie = protection.createCSRFCookie('my-token')
      expect(cookie).toContain('csrf-token=my-token')
      expect(cookie).not.toContain('HttpOnly')
    })

    it('includes Secure and SameSite=Strict', () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      const cookie = protection.createCSRFCookie('tok')
      expect(cookie.toLowerCase()).toContain('secure')
      expect(cookie.toLowerCase()).toContain('samesite=strict')
    })
  })

  describe('addTokenToResponse', () => {
    it('appends Set-Cookie header to response', () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      const original = new Response('body', { status: 200 })
      const updated = protection.addTokenToResponse(original, 'new-token')
      expect(updated.headers.get('Set-Cookie')).toContain('csrf-token=new-token')
      expect(updated.status).toBe(200)
    })

    it('preserves existing response headers', () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      const original = new Response('body', {
        status: 201,
        headers: { 'x-custom': 'value' },
      })
      const updated = protection.addTokenToResponse(original, 'tok')
      expect(updated.headers.get('x-custom')).toBe('value')
      expect(updated.status).toBe(201)
    })
  })

  describe('validateOrReject', () => {
    it('returns null for GET (safe method)', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      const result = await protection.validateOrReject(makeRequest('GET'), null)
      expect(result).toBeNull()
    })

    it('returns 401 for POST with no sessionId', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      const req = makeRequest('POST', { headers: { 'x-csrf-token': 'tok' } })
      const response = await protection.validateOrReject(req, null)
      expect(response?.status).toBe(401)
      const body = await response?.json() as any
      expect(body.error).toBe('Authentication required')
    })

    it('returns 403 for POST with invalid token', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('expected') })
      const req = makeRequest('POST', { headers: { 'x-csrf-token': 'wrong' } })
      const response = await protection.validateOrReject(req, 'sess-1')
      expect(response?.status).toBe(403)
      const body = await response?.json() as any
      expect(body.error).toBe('Invalid CSRF token')
    })

    it('returns null for POST with valid token', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager('tok') })
      const req = makeRequest('POST', { headers: { 'x-csrf-token': 'tok' } })
      const result = await protection.validateOrReject(req, 'sess-1')
      expect(result).toBeNull()
    })

    it('returns null for OPTIONS with no session', async () => {
      const protection = new WorkersCSRFProtection({ sessionManager: makeSessionManager() })
      const result = await protection.validateOrReject(makeRequest('OPTIONS'), null)
      expect(result).toBeNull()
    })
  })
})
