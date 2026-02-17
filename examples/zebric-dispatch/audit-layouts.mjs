#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BlueprintParser } from '../../packages/runtime-node/dist/index.js'
import { HTMLRenderer } from '../../packages/runtime-core/dist/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const blueprintPath = path.join(__dirname, 'blueprint.toml')

const parser = new BlueprintParser()
const blueprintContent = fs.readFileSync(blueprintPath, 'utf8')
const blueprint = parser.parse(blueprintContent, 'toml', blueprintPath)
const renderer = new HTMLRenderer(blueprint)

const sampleEntityRow = (entityName) => {
  if (entityName === 'Request') {
    return {
      id: 'req_01',
      title: 'Sample request',
      description: 'Sample description',
      status: 'new',
      source: 'manual',
      priority: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  if (entityName === 'RequestCluster') {
    return {
      id: 'clu_01',
      title: 'Checkout reliability',
      summary: 'Requests related to checkout issues',
      requestCount: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  return { id: 'row_01', name: 'Sample row' }
}

const sampleDataForPage = (page) => {
  const data = {}
  for (const [name, query] of Object.entries(page.queries || {})) {
    const row = sampleEntityRow(query.entity)
    data[name] = page.layout === 'detail' ? row : [row]
  }
  return data
}

const results = []
for (const page of blueprint.pages) {
  const html = renderer.renderPage({
    page,
    data: sampleDataForPage(page),
    params: { id: 'req_01' },
    query: {}
  })

  const hasAnyForm = html.includes('<form')
  const hasSignInForm = html.includes('id="sign-in-form"')
  const hasTable = html.includes('<table')
  const hasDashboardGrid = html.includes('grid grid-cols-1')

  let ok = true
  let reason = 'ok'

  if (page.layout === 'list') {
    if (!hasTable) {
      ok = false
      reason = 'list layout did not render a table'
    } else if (hasAnyForm) {
      ok = false
      reason = 'list layout rendered form markup unexpectedly'
    }
  } else if (page.layout === 'dashboard') {
    if (!hasDashboardGrid) {
      ok = false
      reason = 'dashboard layout did not render widget grid'
    } else if (hasAnyForm) {
      ok = false
      reason = 'dashboard layout rendered form markup unexpectedly'
    }
  } else if (page.layout === 'form') {
    if (!hasAnyForm) {
      ok = false
      reason = 'form layout did not render a form element'
    }
  } else if (page.layout === 'detail') {
    if (hasSignInForm) {
      ok = false
      reason = 'detail layout rendered sign-in form unexpectedly'
    }
  }

  if (hasSignInForm && page.auth === 'none') {
    ok = false
    reason = 'auth:none page rendered sign-in form'
  }

  results.push({
    path: page.path,
    layout: page.layout,
    auth: page.auth || 'required',
    result: ok ? 'PASS' : 'FAIL',
    reason
  })
}

console.table(results)

const failures = results.filter((row) => row.result === 'FAIL')
if (failures.length > 0) {
  console.error(`\nFound ${failures.length} layout/auth mismatch(es).`)
  process.exit(1)
}

console.log('\nAll routes matched expected layout markers.')
