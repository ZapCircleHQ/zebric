#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BlueprintParser } from '../../packages/runtime-node/dist/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const blueprintPath = path.join(__dirname, 'blueprint.toml')
const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')

const parser = new BlueprintParser()
const blueprintContent = fs.readFileSync(blueprintPath, 'utf8')
const blueprint = parser.parse(blueprintContent, 'toml', blueprintPath)

const concretePath = (pagePath) => {
  return pagePath
    .replace(/:id\b/g, 'req_01')
    .replace(/\{id\}/g, 'req_01')
}

const checkHtml = (page, html) => {
  const hasAnyForm = html.includes('<form')
  const hasSignInForm = html.includes('id="sign-in-form"') || html.includes('Sign in to continue')
  const hasTable = html.includes('<table')
  const hasListEmptyState = html.includes('No ') && html.includes(' found') && html.includes('Create first ')
  const hasDashboardGrid = html.includes('grid grid-cols-1')

  let ok = true
  let reason = 'ok'

  if (page.layout === 'list') {
    if (!hasTable && !hasListEmptyState) {
      ok = false
      reason = 'list layout rendered neither table nor list empty-state markup'
    } else if (hasAnyForm) {
      ok = false
      reason = 'list layout rendered form markup unexpectedly'
    }
  } else if (page.layout === 'dashboard') {
    if (!hasDashboardGrid) {
      ok = false
      reason = 'dashboard layout did not render widget grid markup'
    } else if (hasAnyForm) {
      ok = false
      reason = 'dashboard layout rendered form markup unexpectedly'
    }
  } else if (page.layout === 'form') {
    if (!hasAnyForm) {
      ok = false
      reason = 'form layout did not render a form element'
    }
  }

  if (page.auth === 'none' && hasSignInForm) {
    ok = false
    reason = 'auth:none page rendered sign-in form'
  }

  return { ok, reason }
}

const isAuthRedirect = (location) =>
  typeof location === 'string' && location.startsWith('/auth/sign-in')

const results = []
let failed = 0

for (const page of blueprint.pages) {
  const urlPath = concretePath(page.path)
  const url = `${baseUrl}${urlPath}`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/html' },
      redirect: 'manual'
    })
    const html = await res.text()
    const location = res.headers.get('location') || ''
    const authMode = page.auth || 'required'

    let ok = true
    let reason = 'ok'

    if (authMode === 'required') {
      const redirectedToSignIn = (res.status === 302 || res.status === 303) && isAuthRedirect(location)
      const renderedSignIn = res.status === 200 && (html.includes('id="sign-in-form"') || html.includes('Sign in to continue'))
      if (!redirectedToSignIn && !renderedSignIn) {
        ok = false
        reason = 'required auth page did not redirect/render sign-in'
      }
    } else {
      const checked = checkHtml(page, html)
      ok = checked.ok
      reason = checked.reason
    }
    if (!ok) failed++

    results.push({
      path: page.path,
      fetched: urlPath,
      status: res.status,
      location,
      layout: page.layout,
      auth: authMode,
      result: ok ? 'PASS' : 'FAIL',
      reason
    })
  } catch (error) {
    failed++
    results.push({
      path: page.path,
      fetched: urlPath,
      status: 'ERR',
      location: '',
      layout: page.layout,
      auth: page.auth || 'required',
      result: 'FAIL',
      reason: `request failed: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}

console.table(results)
if (failed > 0) {
  console.error(`\nFound ${failed} live route/layout mismatch(es).`)
  process.exit(1)
}

console.log(`\nAll live routes matched expected layout markers at ${baseUrl}.`)
