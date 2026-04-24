/**
 * Platform-agnostic lookup search handler.
 *
 * Resolves the lookup config from the blueprint (form field OR widget mount),
 * calls the query executor's `search`, and shapes results as `{id, label}`
 * using the configured `display` template.
 */

import type { Blueprint } from '../../types/blueprint.js'
import type { QueryExecutorPort, SessionManagerPort, HttpRequest } from '../../routing/request-ports.js'
import { formatDisplay } from './format.js'

export interface LookupSearchParams {
  page?: string | null
  field?: string | null
  q?: string | null
}

export interface LookupSearchDeps {
  queryExecutor: QueryExecutorPort
  sessionManager?: SessionManagerPort
}

export interface LookupSearchResult {
  status: number
  body: any
}

interface ResolvedLookupConfig {
  entity: string
  search: string[]
  display?: string
  limit?: number
  filter?: Record<string, any>
}

export function resolveLookupConfig(
  blueprint: Blueprint,
  pagePath: string,
  field?: string | null
): ResolvedLookupConfig | null {
  const page = (blueprint.pages || []).find((p) => p.path === pagePath)
  if (!page) return null

  if (field) {
    const formField = page.form?.fields?.find((f) => f.name === field)
    if (formField?.type === 'lookup' && formField.lookup) {
      return formField.lookup as ResolvedLookupConfig
    }
    return null
  }

  const widget: any = page.widget
  if (widget?.kind === 'lookup' && typeof widget.entity === 'string' && Array.isArray(widget.search)) {
    return {
      entity: widget.entity,
      search: widget.search,
      display: widget.display,
      limit: widget.limit,
      filter: widget.filter,
    }
  }
  return null
}

export async function handleLookupSearch(
  blueprint: Blueprint,
  params: LookupSearchParams,
  request: HttpRequest,
  deps: LookupSearchDeps
): Promise<LookupSearchResult> {
  const page = params.page
  if (!page) {
    return { status: 400, body: { error: 'Missing page' } }
  }

  const config = resolveLookupConfig(blueprint, page, params.field)
  if (!config) {
    return { status: 404, body: { error: 'No lookup configured for this page/field' } }
  }

  const session = deps.sessionManager ? await deps.sessionManager.getSession(request as any) : null

  try {
    const records = await deps.queryExecutor.search(config.entity, config.search, params.q ?? '', {
      limit: config.limit,
      filter: config.filter,
      context: { session },
    })

    const results = records.map((r: any) => ({
      id: r.id,
      label: formatDisplay(r, config.display, config.search),
    }))
    return { status: 200, body: { results } }
  } catch (err) {
    return {
      status: 500,
      body: {
        error: 'Search failed',
        details: err instanceof Error ? err.message : 'Unknown error'
      }
    }
  }
}
