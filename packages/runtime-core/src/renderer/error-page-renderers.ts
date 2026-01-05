/**
 * Error Page Renderers
 *
 * Error page rendering (404, 500, generic errors)
 */

import type { Theme } from './theme.js'
import { escapeHtml, safe } from '../security/html-escape.js'

export class ErrorPageRenderers {
  constructor(private theme: Theme) {}

  /**
   * Render 404 Not Found page
   */
  render404(path: string): { title: string; content: import('../security/html-escape.js').SafeHtml } {
    const content = safe(`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <div class="${this.theme.card}">
          <div class="p-12 text-center">
            <h1 class="text-6xl font-bold text-gray-400 mb-4">404</h1>
            <h2 class="${this.theme.heading2}">Page Not Found</h2>
            <p class="text-gray-600 mb-6">
              The page <code class="px-2 py-1 bg-gray-100 rounded">${escapeHtml(path)}</code> does not exist.
            </p>
            <a href="/" class="${this.theme.buttonPrimary}">
              Go to Home
            </a>
          </div>
        </div>
      </div>
    `)
    return { title: '404 - Page Not Found', content }
  }

  /**
   * Render 500 Internal Server Error page
   */
  render500(error?: string): { title: string; content: import('../security/html-escape.js').SafeHtml } {
    const content = safe(`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <div class="${this.theme.card}">
          <div class="p-12 text-center">
            <h1 class="text-6xl font-bold text-red-400 mb-4">500</h1>
            <h2 class="${this.theme.heading2}">Internal Server Error</h2>
            <p class="text-gray-600 mb-6">
              Something went wrong on our end. Please try again later.
            </p>
            ${error ? `
              <details class="text-left">
                <summary class="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Error Details
                </summary>
                <pre class="mt-2 p-4 bg-gray-100 rounded text-xs overflow-auto">${escapeHtml(error)}</pre>
              </details>
            ` : ''}
            <a href="/" class="${this.theme.buttonPrimary} mt-6 inline-block">
              Go to Home
            </a>
          </div>
        </div>
      </div>
    `)
    return { title: '500 - Internal Server Error', content }
  }

  /**
   * Render generic error page
   */
  renderErrorPage(statusCode: number, title: string, message: string): { title: string; content: import('../security/html-escape.js').SafeHtml } {
    const content = safe(`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <div class="${this.theme.card}">
          <div class="p-12 text-center">
            <h1 class="text-6xl font-bold text-gray-400 mb-4">${statusCode}</h1>
            <h2 class="${this.theme.heading2}">${escapeHtml(title)}</h2>
            <p class="text-gray-600 mb-6">
              ${escapeHtml(message)}
            </p>
            <a href="/" class="${this.theme.buttonPrimary}">
              Go to Home
            </a>
          </div>
        </div>
      </div>
    `)
    return { title: `${statusCode} - ${title}`, content }
  }
}
