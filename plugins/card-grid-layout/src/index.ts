/**
 * Card Grid Layout Plugin
 *
 * Renders lists as a responsive card grid instead of a table.
 * Perfect for image-heavy content, product catalogs, etc.
 */

import type { Plugin, LayoutRenderer, LayoutRendererContext, EngineAPI } from '@zebric/runtime'

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(unsafe: string | number | boolean | null | undefined): string {
  if (unsafe === null || unsafe === undefined) return ''
  const str = String(unsafe)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Card Grid Layout Renderer
 */
const cardGridRenderer: LayoutRenderer = (context: LayoutRendererContext) => {
  const { page, data, theme } = context

  // Get the query data
  const queryName = Object.keys(page.queries || {})[0]
  const items = data[queryName] || []

  // Get display fields (first 3 fields excluding id, createdAt, updatedAt)
  const sampleItem = items[0] || {}
  const displayFields = Object.keys(sampleItem)
    .filter(key => !['id', 'createdAt', 'updatedAt', 'userId', 'authorId'].includes(key))
    .slice(0, 3)

  // Render card grid
  return `
    <div class="${theme.container}">
      <header class="${theme.pageHeader}">
        <h1 class="${theme.heading1}">${escapeHtml(page.title)}</h1>
      </header>

      ${items.length === 0
        ? `<div class="${theme.emptyState}">No items found</div>`
        : `
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
            ${items.map((item: any) => `
              <div class="${theme.card} hover:shadow-lg transition-shadow cursor-pointer" onclick="window.location.href='${page.path}/${item.id}'">
                <div class="p-6">
                  ${displayFields.map(field => {
                    const value = item[field]
                    if (field === 'title' || field === 'name') {
                      return `<h3 class="${theme.heading3} mb-2">${escapeHtml(value)}</h3>`
                    } else if (field === 'body' || field === 'description') {
                      const truncated = String(value).substring(0, 150) + (String(value).length > 150 ? '...' : '')
                      return `<p class="text-gray-600 mb-4">${escapeHtml(truncated)}</p>`
                    } else {
                      return `<div class="text-sm text-gray-500">${escapeHtml(value)}</div>`
                    }
                  }).join('')}
                </div>
                <div class="px-6 py-4 bg-gray-50 border-t border-gray-200">
                  <a href="${page.path}/${item.id}" class="${theme.linkPrimary}">
                    View Details →
                  </a>
                </div>
              </div>
            `).join('')}
          </div>
        `
      }
    </div>
  `
}

/**
 * Plugin Definition
 */
const cardGridLayoutPlugin: Plugin = {
  name: '@zebric-plugin/card-grid-layout',
  version: '0.1.0',
  description: 'Card grid layout renderer for list pages',

  provides: {
    layouts: ['card-grid']
  },

  // Layout renderers
  layouts: {
    'card-grid': cardGridRenderer
  },

  // Initialize plugin
  async init(engine: EngineAPI, config: Record<string, any>) {
    engine.log.info('Card Grid Layout Plugin initialized', {
      version: '0.1.0',
      config
    })
  }
}

export default cardGridLayoutPlugin
