/**
 * Default Templates
 *
 * Built-in templates for standard layouts (list, detail, form, etc.)
 * These templates can be overridden by custom templates in Blueprints.
 *
 * IMPORTANT: These are simplified placeholder templates for demonstration purposes.
 * By default, HTMLRenderer uses its built-in renderListLayout(), renderDetailLayout(), etc.
 * methods which provide full-featured HTML rendering.
 *
 * These default templates are only used if you explicitly call renderer.loadDefaultTemplates()
 * which might be useful for:
 * - Creating a template-based rendering system
 * - Providing simpler templates for edge/Workers environments
 * - Demonstrating the template system
 *
 * For production use, the built-in HTMLRenderer methods are recommended.
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
