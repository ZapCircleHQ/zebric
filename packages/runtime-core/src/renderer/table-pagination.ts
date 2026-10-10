import type { Blueprint, Page, Query } from '../types/blueprint.js'
import { resolvePageUX } from './ux-config.js'

export interface TablePagination {
  page: number
  pageSize: number
  hasNext: boolean
}

/** Preserve the query's initial offset and fetch one lookahead row. */
export function resolveTablePagination(blueprint: Blueprint, page: Page, params: Record<string, string>): { query: Query; pagination: TablePagination } | undefined {
  if (page.layout !== 'list' || resolvePageUX(blueprint, page).data?.pagination !== 'server') return undefined
  const query = Object.values(page.queries ?? {})[0]
  if (!query) return undefined
  const value = params.zb_page ?? '1'
  const currentPage = /^\d{1,6}$/.test(value) ? Math.max(1, Number(value)) : 1
  const pageSize = Math.max(1, Math.min(250, query.limit ?? 25))
  return {
    query: { ...query, limit: pageSize + 1, offset: (query.offset ?? 0) + (currentPage - 1) * pageSize },
    pagination: { page: currentPage, pageSize, hasNext: false },
  }
}
