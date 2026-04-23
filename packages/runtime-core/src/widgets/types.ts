/**
 * Widget types — the declarative interactive view contract.
 */

import type { Blueprint, Page, Widget } from '../types/blueprint.js'
import type { Theme } from '../renderer/theme.js'
import type { SafeHtml } from '../security/html-escape.js'

export interface WidgetRenderContext {
  page: Page
  widget: Widget
  data: Record<string, any>
  blueprint: Blueprint
  theme: Theme
}

export type WidgetRenderer = (ctx: WidgetRenderContext) => SafeHtml

export interface WidgetEventRequest {
  page: string
  event: string
  row: { entity: string; id: string }
  ctx: Record<string, any>
}

export interface WidgetEventResolved {
  entity: string
  id: string
  update: Record<string, any>
  workflow?: string
}
