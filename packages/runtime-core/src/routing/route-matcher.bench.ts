/**
 * RouteMatcher Benchmarks
 *
 * Measures route resolution cost — called on every HTTP request.
 */

import { bench, describe } from 'vitest'
import { RouteMatcher } from './route-matcher.js'
import type { Page } from '../types/blueprint.js'

const matcher = new RouteMatcher()

const makePage = (path: string): Page => ({
  path,
  title: path,
  layout: 'list',
})

// Route tables of increasing size
const smallRouteTable: Page[] = [
  makePage('/'),
  makePage('/posts'),
  makePage('/posts/:id'),
  makePage('/posts/:id/edit'),
  makePage('/about'),
]

const mediumRouteTable: Page[] = [
  makePage('/'),
  makePage('/posts'),
  makePage('/posts/:id'),
  makePage('/posts/:id/edit'),
  makePage('/posts/new'),
  makePage('/users'),
  makePage('/users/:id'),
  makePage('/users/:id/settings'),
  makePage('/tags'),
  makePage('/tags/:slug'),
  makePage('/categories'),
  makePage('/categories/:id'),
  makePage('/search'),
  makePage('/about'),
  makePage('/contact'),
]

const largeRouteTable: Page[] = [
  ...mediumRouteTable,
  makePage('/dashboard'),
  makePage('/dashboard/analytics'),
  makePage('/dashboard/settings'),
  makePage('/admin'),
  makePage('/admin/users'),
  makePage('/admin/users/:id'),
  makePage('/admin/posts'),
  makePage('/admin/posts/:id'),
  makePage('/api/health'),
  makePage('/profile'),
  makePage('/profile/edit'),
  makePage('/notifications'),
  makePage('/tasks'),
  makePage('/tasks/:id'),
  makePage('/tasks/:id/edit'),
  makePage('/tasks/new'),
]

describe('RouteMatcher - static routes', () => {
  bench('match root path (5 routes)', () => {
    matcher.match('/', smallRouteTable)
  })

  bench('match root path (15 routes)', () => {
    matcher.match('/', mediumRouteTable)
  })

  bench('match root path (30 routes)', () => {
    matcher.match('/', largeRouteTable)
  })

  bench('match last static route (30 routes)', () => {
    matcher.match('/notifications', largeRouteTable)
  })
})

describe('RouteMatcher - dynamic routes', () => {
  bench('match dynamic route :id (5 routes)', () => {
    matcher.match('/posts/abc123', smallRouteTable)
  })

  bench('match dynamic route :id (15 routes)', () => {
    matcher.match('/posts/abc123', mediumRouteTable)
  })

  bench('match dynamic route :id (30 routes)', () => {
    matcher.match('/tasks/abc123', largeRouteTable)
  })

  bench('match nested dynamic route /:id/edit', () => {
    matcher.match('/posts/abc123/edit', largeRouteTable)
  })
})

describe('RouteMatcher - with query string', () => {
  bench('match path with query string', () => {
    matcher.match('/posts?page=2&limit=10&sort=desc', mediumRouteTable)
  })

  bench('match dynamic route with query string', () => {
    matcher.match('/posts/abc123?expand=author&format=full', mediumRouteTable)
  })
})

describe('RouteMatcher - no match', () => {
  bench('no match (5 routes)', () => {
    matcher.match('/does-not-exist', smallRouteTable)
  })

  bench('no match (30 routes)', () => {
    matcher.match('/does-not-exist', largeRouteTable)
  })
})
