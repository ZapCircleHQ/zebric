import { describe, it, expect } from 'vitest'
import { RouteMatcher } from './route-matcher.js'
import type { Page } from '../types/blueprint.js'

const makePage = (path: string, title = 'Test'): Page => ({
  path,
  title,
  layout: 'detail',
})

describe('RouteMatcher', () => {
  const matcher = new RouteMatcher()

  describe('exact matching', () => {
    it('should match exact static paths', () => {
      const pages = [makePage('/'), makePage('/tasks'), makePage('/about')]
      const result = matcher.match('/tasks', pages)
      expect(result).not.toBeNull()
      expect(result!.page.path).toBe('/tasks')
      expect(result!.params).toEqual({})
    })

    it('should match root path', () => {
      const pages = [makePage('/')]
      const result = matcher.match('/', pages)
      expect(result).not.toBeNull()
      expect(result!.page.path).toBe('/')
    })

    it('should return null for no match', () => {
      const pages = [makePage('/tasks')]
      expect(matcher.match('/users', pages)).toBeNull()
    })
  })

  describe('dynamic routes with :param syntax', () => {
    it('should match :param patterns', () => {
      const pages = [makePage('/tasks/:id')]
      const result = matcher.match('/tasks/123', pages)
      expect(result).not.toBeNull()
      expect(result!.params.id).toBe('123')
    })

    it('should match multiple :params', () => {
      const pages = [makePage('/users/:userId/posts/:postId')]
      const result = matcher.match('/users/1/posts/42', pages)
      expect(result).not.toBeNull()
      expect(result!.params.userId).toBe('1')
      expect(result!.params.postId).toBe('42')
    })

    it('should match :param with trailing segments', () => {
      const pages = [makePage('/tasks/:id/edit')]
      const result = matcher.match('/tasks/abc/edit', pages)
      expect(result).not.toBeNull()
      expect(result!.params.id).toBe('abc')
    })
  })

  describe('dynamic routes with {param} syntax', () => {
    it('should match {param} patterns', () => {
      const pages = [makePage('/tasks/{id}')]
      const result = matcher.match('/tasks/123', pages)
      expect(result).not.toBeNull()
      expect(result!.params.id).toBe('123')
    })

    it('should match multiple {params}', () => {
      const pages = [makePage('/users/{userId}/posts/{postId}')]
      const result = matcher.match('/users/1/posts/42', pages)
      expect(result).not.toBeNull()
      expect(result!.params.userId).toBe('1')
      expect(result!.params.postId).toBe('42')
    })

    it('should match {param} with trailing segments', () => {
      const pages = [makePage('/tasks/{id}/edit')]
      const result = matcher.match('/tasks/abc/edit', pages)
      expect(result).not.toBeNull()
      expect(result!.params.id).toBe('abc')
    })
  })

  describe('query string handling', () => {
    it('should parse query strings', () => {
      const pages = [makePage('/tasks')]
      const result = matcher.match('/tasks?status=active&page=1', pages)
      expect(result).not.toBeNull()
      expect(result!.query.status).toBe('active')
      expect(result!.query.page).toBe('1')
    })

    it('should handle empty query strings', () => {
      const pages = [makePage('/tasks')]
      const result = matcher.match('/tasks', pages)
      expect(result).not.toBeNull()
      expect(result!.query).toEqual({})
    })

    it('should decode URL-encoded values', () => {
      const pages = [makePage('/search')]
      const result = matcher.match('/search?q=hello%20world', pages)
      expect(result!.query.q).toBe('hello world')
    })
  })

  describe('exact match priority', () => {
    it('should prefer exact match over dynamic match', () => {
      const pages = [makePage('/tasks/new', 'New Task'), makePage('/tasks/{id}', 'Detail')]
      const result = matcher.match('/tasks/new', pages)
      expect(result).not.toBeNull()
      expect(result!.page.title).toBe('New Task')
      expect(result!.params).toEqual({})
    })
  })

  describe('generatePath', () => {
    it('should generate path with :param', () => {
      const result = matcher.generatePath('/tasks/:id', { id: '123' })
      expect(result).toBe('/tasks/123')
    })

    it('should generate path with {param}', () => {
      const result = matcher.generatePath('/tasks/{id}', { id: '123' })
      expect(result).toBe('/tasks/123')
    })

    it('should encode special characters', () => {
      const result = matcher.generatePath('/tasks/{id}', { id: 'hello world' })
      expect(result).toBe('/tasks/hello%20world')
    })

    it('should throw for missing params', () => {
      expect(() => matcher.generatePath('/tasks/{id}', {})).toThrow('Missing parameter: id')
    })
  })
})
