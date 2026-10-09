import type { Actor } from '../auth/actor.js'
import type { Page } from '../types/blueprint.js'

/** Committed storage changes, distinct from audit records and domain events. */
export interface ZebricChangeEvent {
  id: string
  entity: string
  recordId?: string
  operation: 'create' | 'update' | 'delete'
  cursor: string
  timestamp: string
}
export interface LiveDependency { entity: string }
export interface LiveSession {
  page: string
  path: string
  actor: Actor | null
  dependencies: LiveDependency[]
  cursor: string
}
export interface LiveInvalidation { type: 'invalidate'; cursor: string }
export interface CommittedChangeSource {
  currentCursor(): Promise<string>
  changesAfter(cursor: string, limit?: number): Promise<ZebricChangeEvent[]>
}
export interface LiveChangeSource extends CommittedChangeSource {
  reconcile(dependencies: LiveDependency[], cursor: string): Promise<{ cursor: string; changed: boolean }>
}
export interface LiveSubscription { close(): void }
export interface LiveTransport {
  subscribe(session: LiveSession, receive: (event: LiveInvalidation) => void): LiveSubscription
}

/** Conservative entity dependencies. Extend this independently of Blueprint syntax. */
export function discoverLiveDependencies(page: Page): LiveDependency[] {
  const entities = new Set(Object.values(page.queries ?? {}).map(query => query.entity))
  if (page.widget?.entity) entities.add(page.widget.entity)
  if (page.widget?.column_entity) entities.add(page.widget.column_entity)
  if (page.form?.entity) entities.add(page.form.entity)
  for (const field of page.form?.fields ?? []) {
    if (field.lookup?.entity) entities.add(field.lookup.entity)
  }
  return [...entities].filter(Boolean).map(entity => ({ entity }))
}

export const DEFAULT_REAUTHORIZE_INTERVAL_MS = 30_000
export const DEFAULT_CHANGE_RETENTION_MS = 24 * 60 * 60 * 1000

/** Resolve the Blueprint `[live]` settings to milliseconds, applying defaults. */
export function resolveLiveConfig(blueprint?: { live?: { reauthorize_interval_seconds?: number; change_retention_hours?: number } }) {
  const live = blueprint?.live
  return {
    reauthorizeIntervalMs: live?.reauthorize_interval_seconds !== undefined
      ? live.reauthorize_interval_seconds * 1000 : DEFAULT_REAUTHORIZE_INTERVAL_MS,
    changeRetentionMs: live?.change_retention_hours !== undefined
      ? live.change_retention_hours * 3_600_000 : DEFAULT_CHANGE_RETENTION_MS,
  }
}

export function validLiveCursor(cursor: string): boolean {
  return /^\d+$/.test(cursor) && Number.isSafeInteger(Number(cursor))
}
