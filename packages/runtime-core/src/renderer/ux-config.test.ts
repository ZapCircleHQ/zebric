import { describe, expect, it } from 'vitest'
import { resolvePageUX } from './ux-config.js'
import { resolveTablePagination } from './table-pagination.js'
import type { Blueprint, Page } from '../types/blueprint.js'

const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task', limit: 10, offset: 5 } } }
const blueprint = { ux: {
  pattern: 'data-table@v1', interaction: { selection: 'multi', row_click: 'select' },
  data: { pagination: 'server', density: 'compact' },
  patterns: { 'data-table@v1': { pattern: 'data-table@v1', data: { filters: 'top-bar' } } },
} } as Blueprint

describe('UX resolution and table paging', () => {
  it('preserves nested defaults when a page overrides one field', () => {
    const ux = resolvePageUX(blueprint, { ...page, ux: { interaction: { selection: 'none' }, data: { density: 'spacious' } } })
    expect(ux.interaction).toEqual({ selection: 'none', row_click: 'select' })
    expect(ux.data).toEqual({ pagination: 'server', density: 'spacious', filters: 'top-bar' })
  })
  it('uses lookahead and retains the original offset without mutating the query', () => {
    expect(resolveTablePagination(blueprint, page, { zb_page: '3' })?.query).toEqual({ entity: 'Task', limit: 11, offset: 25 })
    expect(page.queries?.tasks?.offset).toBe(5)
  })
  it.each(['-1', 'NaN', '2.5', 'Infinity', '999999999999999999999'])('bounds invalid page input %s', value => {
    expect(resolveTablePagination(blueprint, page, { zb_page: value })?.pagination.page).toBe(1)
  })
  it('leaves detail queries and explicitly disabled pagination alone', () => {
    expect(resolveTablePagination(blueprint, { ...page, layout: 'detail' }, {})).toBeUndefined()
    expect(resolveTablePagination(blueprint, { ...page, ux: { data: { pagination: 'none' } } }, {})).toBeUndefined()
  })
})
