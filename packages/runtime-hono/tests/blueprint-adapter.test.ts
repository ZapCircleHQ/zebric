import { describe, it, expect } from 'vitest'
import { BlueprintHttpAdapter } from '../src/blueprint-adapter.js'
import type { Blueprint, RendererPort } from '@zebric/runtime-core'
import { Hono } from 'hono'

const testBlueprint: Blueprint = {
  version: '1.0.0',
  project: {
    name: 'Test App',
    version: '1.0.0',
    runtime: { min_version: '0.1.0' }
  },
  entities: [],
  pages: [
    {
      path: '/',
      title: 'Home',
      layout: 'list',
      auth: 'optional'
    }
  ]
}

const renderer: RendererPort = {
  renderPage: () => 'rendered-content'
}

function createAdapter() {
  return new BlueprintHttpAdapter({
    blueprint: structuredClone(testBlueprint),
    renderer
  })
}

describe('BlueprintHttpAdapter', () => {
  it('renders matching routes via handle()', async () => {
    const adapter = createAdapter()
    const response = await adapter.handle(new Request('http://example.com/'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('rendered-content')
  })

  it('returns 404 for unknown routes', async () => {
    const adapter = createAdapter()
    const response = await adapter.handle(new Request('http://example.com/missing'))

    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload).toHaveProperty('error', 'Page not found')
  })

  it('plugs into Hono middleware via toMiddleware()', async () => {
    const adapter = createAdapter()
    const app = new Hono()

    app.use('*', adapter.toMiddleware())

    const response = await app.request('/')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('rendered-content')
  })
})
