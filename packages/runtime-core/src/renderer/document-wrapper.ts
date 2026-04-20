/**
 * Document Wrapper
 *
 * HTML document structure, navigation, footer, client scripts
 */

import type { Blueprint } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { escapeHtml, SafeHtml, safe } from '../security/html-escape.js'
import { INLINE_TAILWIND_STYLE_TAG } from './tailwind-style.js'
import type { FlashMessage } from '../routing/request-ports.js'
import { renderNavigation } from './navigation-renderer.js'
import { renderFlash } from './feedback-renderer.js'

export class DocumentWrapper {
  private reloadScript?: string

  constructor(
    private blueprint: Blueprint,
    private theme: Theme
  ) {}

  /**
   * Set reload script for hot reload (development mode only)
   */
  setReloadScript(script: string): void {
    this.reloadScript = script
  }

  /**
   * Wrap content in complete HTML document
   */
  wrapInDocument(title: string, content: SafeHtml, session?: any, currentPath?: string, flash?: FlashMessage): string {
    const viewTransitions = this.blueprint.ui?.view_transitions !== false
    const escapedTitle = escapeHtml(title)
    const escapedProjectName = escapeHtml(this.blueprint.project.name)

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${escapedTitle} - ${escapedProjectName}</title>

          ${this.renderInlineStyles().html}

          ${viewTransitions ? `
            <meta name="view-transition" content="same-origin">
            <style>
              @view-transition {
                navigation: auto;
              }

              ::view-transition-old(root),
              ::view-transition-new(root) {
                animation-duration: 0.2s;
                animation-timing-function: ease-in-out;
              }
            </style>
          ` : ''}

          <!-- Accessibility styles -->
          <style>
            /* Screen reader only content */
            .sr-only {
              position: absolute;
              width: 1px;
              height: 1px;
              padding: 0;
              margin: -1px;
              overflow: hidden;
              clip: rect(0, 0, 0, 0);
              white-space: nowrap;
              border-width: 0;
            }

            /* Show when focused for skip links */
            .sr-only:focus,
            .sr-only:active {
              position: static;
              width: auto;
              height: auto;
              padding: 0.5rem 1rem;
              margin: 0;
              overflow: visible;
              clip: auto;
              white-space: normal;
              background-color: #1F2937;
              color: white;
              z-index: 9999;
            }

            /* Enhanced focus visibility for keyboard navigation */
            .keyboard-nav *:focus {
              outline: 2px solid #4F46E5;
              outline-offset: 2px;
            }
          </style>
        </head>
        <body class="${this.theme.body}">
          <!-- Skip navigation link for keyboard users -->
          <a href="#main-content" class="sr-only focus:not-sr-only">
            Skip to main content
          </a>

          ${renderNavigation(this.blueprint, this.theme, session, currentPath).html}

          <main id="main-content" role="main" aria-label="Main content" class="min-h-screen py-8">
            ${renderFlash(this.blueprint, flash).html}
            ${content.html}
          </main>

          ${this.renderFooter().html}
          ${this.renderClientScript().html}
          ${this.reloadScript || ''}
        </body>
      </html>
    `
  }

  /**
   * Render footer
   */
  private renderFooter(): SafeHtml {
    return safe(`
      <footer class="border-t border-gray-200 mt-12 py-6">
        <div class="${this.theme.container}">
          <p class="text-center text-sm text-gray-500">
            Powered by Zebric Engine v0.1.1
          </p>
        </div>
      </footer>
    `)
  }

  private renderInlineStyles(): SafeHtml {
    return safe(INLINE_TAILWIND_STYLE_TAG)
  }

  /**
   * Render client-side enhancement script
   */
  private renderClientScript(): SafeHtml {
    return safe(`
      <script>
        // Minimal form enhancement
        document.querySelectorAll('form[data-enhance]').forEach(form => {
          if (form.dataset.enhance === 'none') return

          form.addEventListener('submit', async (e) => {
            e.preventDefault()

            const submitBtn = form.querySelector('button[type="submit"]')
            const originalText = submitBtn ? submitBtn.textContent : ''
            if (submitBtn) {
              submitBtn.textContent = 'Saving...'
              submitBtn.disabled = true
            }

            // Reset inline errors
            form.querySelectorAll('[data-error]').forEach(el => {
              el.textContent = ''
              el.classList.add('hidden')
            })

            try {
              const formData = new FormData(form)

              // Check if form has file inputs
              const hasFiles = Array.from(formData.entries()).some(([_, value]) => value instanceof File)
              const csrfEntry = formData.get('_csrf')
              const cookieCsrf = document.cookie
                .split(';')
                .map(part => part.trim())
                .find(part => part.startsWith('csrf-token='))
                ?.split('=')
                ?.slice(1)
                ?.join('=')
              const cookieToken = cookieCsrf ? decodeURIComponent(cookieCsrf) : null
              const formToken = csrfEntry ? String(csrfEntry) : null
              const csrfValue = cookieToken || formToken
              if (csrfValue) {
                formData.set('_csrf', csrfValue)
              }
              const csrfHeader = csrfValue

              let response
              if (hasFiles) {
                // Use multipart/form-data for file uploads
                response = await fetch(form.action, {
                  method: form.getAttribute('method') || 'POST',
                  credentials: 'same-origin',
                  headers: {
                    'Accept': 'application/json',
                    ...(csrfHeader ? { 'x-csrf-token': csrfHeader } : {})
                    // Don't set Content-Type - browser will set it with boundary
                  },
                  body: formData
                })
              } else {
                // Use JSON for regular forms
                const data = Object.fromEntries(formData)
                response = await fetch(form.action, {
                  method: form.getAttribute('method') || 'POST',
                  credentials: 'same-origin',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...(csrfHeader ? { 'x-csrf-token': csrfHeader } : {})
                  },
                  body: JSON.stringify(data)
                })
              }

              const contentType = response.headers.get('content-type') || ''
              const hasJson = contentType.includes('application/json')
              const result = hasJson ? await response.json() : null

              if (response.redirected) {
                window.location.href = response.url
                return
              }

              if (result && result.redirect) {
                window.location.href = result.redirect
                return
              }

              if (!response.ok) {
                if (result?.errors?.length) {
                  result.errors.forEach(err => {
                    const errorEl = form.querySelector('[data-error="' + err.field + '"]')
                    if (errorEl) {
                      errorEl.textContent = err.message
                      errorEl.classList.remove('hidden')
                    }
                  })
                } else {
                  alert(result?.message || 'An error occurred')
                }
              } else if (result?.message) {
                alert(result.message)
              }
            } catch (error) {
              alert('An error occurred')
            } finally {
              if (submitBtn) {
                submitBtn.textContent = originalText || 'Submit'
                submitBtn.disabled = false
              }
            }
          })
        })
      </script>
    `)
  }
}
