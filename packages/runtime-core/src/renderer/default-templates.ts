/**
 * Default Templates
 *
 * Built-in templates for standard layouts (list, detail, form, etc.)
 * These templates can be overridden by custom templates in Blueprints.
 *
 * NOTE: These are simplified placeholder templates.
 * For production use, the existing HTMLRenderer methods provide better layout rendering.
 */

import { StringTemplate } from './template-system.js'
import type { RenderContext } from '../routing/request-ports.js'
import { html, escapeHtml, SafeHtml } from '../security/html-escape.js'
import type { Theme } from './theme.js'

/**
 * Create default templates for a theme
 */
export function createDefaultTemplates(theme: Theme): Map<string, StringTemplate> {
  const templates = new Map<string, StringTemplate>()

  // List layout template
  templates.set('layout:list', new StringTemplate(
    'layout:list',
    'native',
    (context: RenderContext) => renderListLayout(context, theme)
  ))

  // Detail layout template
  templates.set('layout:detail', new StringTemplate(
    'layout:detail',
    'native',
    (context: RenderContext) => renderDetailLayout(context, theme)
  ))

  // Form layout template
  templates.set('layout:form', new StringTemplate(
    'layout:form',
    'native',
    (context: RenderContext) => renderFormLayout(context, theme)
  ))

  // Dashboard layout template
  templates.set('layout:dashboard', new StringTemplate(
    'layout:dashboard',
    'native',
    (context: RenderContext) => renderDashboardLayout(context, theme)
  ))

  return templates
}

/**
 * Render list layout
 */
function renderListLayout(context: RenderContext, theme: Theme): string {
  const { page, data } = context
  const records = Array.isArray(data) ? data : Object.values(data)[0] || []

  return html`
    <div class="${theme.container}">
      <h1 class="${theme.heading1}">${escapeHtml(page.title)}</h1>
      <div class="${theme.card}">
        <p>List layout - ${Array.isArray(records) ? records.length : 0} items</p>
      </div>
    </div>
  `.toString()
}

/**
 * Render detail layout
 */
function renderDetailLayout(context: RenderContext, theme: Theme): string {
  const { page, data } = context

  return html`
    <div class="${theme.container}">
      <h1 class="${theme.heading1}">${escapeHtml(page.title)}</h1>
      <div class="${theme.card}">
        <p>Detail layout</p>
      </div>
    </div>
  `.toString()
}

/**
 * Render form layout
 */
function renderFormLayout(context: RenderContext, theme: Theme): string {
  const { page } = context

  return html`
    <div class="${theme.container}">
      <h1 class="${theme.heading1}">${escapeHtml(page.title)}</h1>
      <div class="${theme.card}">
        <p>Form layout</p>
      </div>
    </div>
  `.toString()
}

/**
 * Render dashboard layout
 */
function renderDashboardLayout(context: RenderContext, theme: Theme): string {
  const { page } = context

  return html`
    <div class="${theme.container}">
      <h1 class="${theme.heading1}">${escapeHtml(page.title)}</h1>
      <div class="${theme.card}">
        <p>Dashboard layout</p>
      </div>
    </div>
  `.toString()
}
