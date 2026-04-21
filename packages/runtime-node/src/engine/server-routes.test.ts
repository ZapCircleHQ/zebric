import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { registerPageRoutes } from './server-routes.js'

describe('registerPageRoutes', () => {
  it('sets a CSRF cookie when a safe page request generated a token', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      injectCsrfTokenIntoRequest(c.req.raw, 'csrf-from-safe-request')
      await next()
    })
    registerPageRoutes(app, htmlAdapter())

    const response = await app.request('/issues/new')

    expect(response.headers.get('set-cookie')).toContain('csrf-token=csrf-from-safe-request')
  })

  it('does not overwrite an existing CSRF cookie', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      injectCsrfTokenIntoRequest(c.req.raw, 'replacement-token')
      await next()
    })
    registerPageRoutes(app, htmlAdapter())

    const response = await app.request('/issues/new', {
      headers: { cookie: 'csrf-token=existing-token' },
    })

    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

function htmlAdapter(): BlueprintHttpAdapter {
  return {
    handle: async () => new Response('<html><body>OK</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
  } as BlueprintHttpAdapter
}
