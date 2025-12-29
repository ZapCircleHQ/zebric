/**
 * Auth Page Renderers
 *
 * Authentication page rendering (sign in, sign up, sign out, login required)
 */

import type { Blueprint, Page } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import type { Template } from './template-system.js'
import { escapeHtml, escapeHtmlAttr, escapeJs } from '../security/html-escape.js'
import { StringTemplate } from './template-system.js'
import { authTemplates } from './generated/auth-templates.js'

export class AuthPageRenderers {
  constructor(
    private blueprint: Blueprint,
    private theme: Theme,
    private authTemplateCache: Map<string, Template>,
    private builtinTemplateEngine: any
  ) {}

  /**
   * Render login required page
   */
  renderLoginRequired(page: Page, request: any): string {
    const target = request.url || page.path || '/'
    const loginUrl = `${this.getLoginPath()}${this.getLoginPath().includes('?') ? '&' : '?'}callbackURL=${encodeURIComponent(target)}`

    return this.renderAuthTemplate('login-required', {
      page,
      auth: { loginUrl },
    })
  }

  /**
   * Render sign-in page
   */
  renderSignInPage(callbackURL: string, message?: string): string {
    const action = this.getLoginAction()
    const escapedCallbackAttr = escapeHtmlAttr(callbackURL || '/')
    const escapedCallbackJs = escapeJs(callbackURL || '/')
    const escapedActionJs = escapeJs(action)
    const feedback = message ? `<p id="auth-feedback" class="text-sm text-emerald-600">${escapeHtml(message)}</p>` : '<p id="auth-feedback" class="text-sm text-emerald-600"></p>'

    return this.renderAuthTemplate('sign-in', {
      renderer: {
        feedback,
        fields: {
          email: `<div>
            <label class="${this.theme.label}" for="email">Email</label>
            <input class="${this.theme.input}" type="email" name="email" id="email" required autocomplete="email">
          </div>`,
          password: `<div>
            <label class="${this.theme.label}" for="password">Password</label>
            <input class="${this.theme.input}" type="password" name="password" id="password" required autocomplete="current-password">
          </div>`,
          meta: `<div class="flex items-center justify-between text-sm text-gray-600">
            <label class="inline-flex items-center">
              <input type="checkbox" name="rememberMe" class="mr-2"> Remember me
            </label>
            <a href="/forgot-password" class="${this.theme.linkSecondary}">Forgot password?</a>
          </div>`
        },
        script: `
          <script>
            document.addEventListener('DOMContentLoaded', () => {
              const form = document.getElementById('sign-in-form')
              if (!form) return
              const feedback = document.getElementById('auth-feedback')
              const endpoint = '${escapedActionJs}'
              const callbackURL = '${escapedCallbackJs}'
              const emailInput = form.querySelector('input[name="email"]')
              const passwordInput = form.querySelector('input[name="password"]')
              const rememberInput = form.querySelector('input[name="rememberMe"]')
              const submitButton = form.querySelector('button[type="submit"]')

              form.addEventListener('submit', async (event) => {
                event.preventDefault()
                if (feedback) {
                  feedback.textContent = ''
                  feedback.classList.remove('text-red-600')
                  feedback.classList.add('text-emerald-600')
                }
                if (submitButton) {
                  submitButton.disabled = true
                  submitButton.textContent = 'Signing in…'
                }

                const payload = {
                  email: emailInput?.value || '',
                  password: passwordInput?.value || '',
                  rememberMe: !!rememberInput?.checked,
                  callbackURL,
                }

                try {
                  const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Accept': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify(payload),
                  })

                  if (response.ok) {
                    window.location.href = callbackURL || '/'
                    return
                  }

                  let message = 'Sign in failed. Please try again.'
                  try {
                    const data = await response.json()
                    message = data?.message || data?.error || message
                  } catch (_) {}

                  if (feedback) {
                    feedback.textContent = message
                    feedback.classList.remove('text-emerald-600')
                    feedback.classList.add('text-red-600')
                  }
                } catch (error) {
                  if (feedback) {
                    feedback.textContent = 'Network error. Please check your connection and try again.'
                    feedback.classList.remove('text-emerald-600')
                    feedback.classList.add('text-red-600')
                  }
                } finally {
                  if (submitButton) {
                    submitButton.disabled = false
                    submitButton.textContent = 'Sign in'
                  }
                }
              })
            })
          </script>
        `
      },
      auth: {
        action,
        callback: escapedCallbackAttr,
        signupPath: this.getSignupPath()
      }
    })
  }

  /**
   * Render sign-up page
   */
  renderSignUpPage(callbackURL: string, message?: string): string {
    const action = '/api/auth/sign-up/email'
    const escapedCallbackAttr = escapeHtmlAttr(callbackURL || '/')
    const escapedCallbackJs = escapeJs(callbackURL || '/')
    const escapedActionJs = escapeJs(action)
    const feedback = message ? `<p id="auth-feedback" class="text-sm text-emerald-600">${escapeHtml(message)}</p>` : '<p id="auth-feedback" class="text-sm text-emerald-600"></p>'

    return this.renderAuthTemplate('sign-up', {
      renderer: {
        feedback,
        fields: {
          name: `<div>
            <label class="${this.theme.label}" for="name">Name</label>
            <input class="${this.theme.input}" type="text" name="name" id="name" required autocomplete="name">
          </div>`,
          email: `<div>
            <label class="${this.theme.label}" for="email">Email</label>
            <input class="${this.theme.input}" type="email" name="email" id="email" required autocomplete="email">
          </div>`,
          password: `<div>
            <label class="${this.theme.label}" for="password">Password</label>
            <input class="${this.theme.input}" type="password" name="password" id="password" required autocomplete="new-password" minlength="8">
            <p class="text-xs text-gray-500 mt-1">At least 8 characters</p>
          </div>`
        },
        script: `
          <script>
            document.addEventListener('DOMContentLoaded', () => {
              const form = document.getElementById('sign-up-form')
              if (!form) return
              const feedback = document.getElementById('auth-feedback')
              const endpoint = '${escapedActionJs}'
              const callbackURL = '${escapedCallbackJs}'
              const nameInput = form.querySelector('input[name="name"]')
              const emailInput = form.querySelector('input[name="email"]')
              const passwordInput = form.querySelector('input[name="password"]')
              const submitButton = form.querySelector('button[type="submit"]')

              form.addEventListener('submit', async (event) => {
                event.preventDefault()
                if (feedback) {
                  feedback.textContent = ''
                  feedback.classList.remove('text-red-600')
                  feedback.classList.add('text-emerald-600')
                }
                if (submitButton) {
                  submitButton.disabled = true
                  submitButton.textContent = 'Creating account…'
                }

                const payload = {
                  name: nameInput?.value || '',
                  email: emailInput?.value || '',
                  password: passwordInput?.value || '',
                  callbackURL,
                }

                try {
                  const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Accept': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify(payload),
                  })

                  if (response.ok) {
                    window.location.href = callbackURL || '/'
                    return
                  }

                  let message = 'Sign up failed. Please try again.'
                  try {
                    const data = await response.json()
                    message = data?.message || data?.error || message
                  } catch (_) {}

                  if (feedback) {
                    feedback.textContent = message
                    feedback.classList.remove('text-emerald-600')
                    feedback.classList.add('text-red-600')
                  }
                } catch (error) {
                  if (feedback) {
                    feedback.textContent = 'Network error. Please check your connection and try again.'
                    feedback.classList.remove('text-emerald-600')
                    feedback.classList.add('text-red-600')
                  }
                } finally {
                  if (submitButton) {
                    submitButton.disabled = false
                    submitButton.textContent = 'Sign up'
                  }
                }
              })
            })
          </script>
        `
      },
      auth: {
        action,
        callback: escapedCallbackAttr,
        loginPath: this.getLoginPath()
      }
    })
  }

  /**
   * Render sign-out page
   */
  renderSignOutPage(callbackURL: string): string {
    const escapedCallbackJs = escapeJs(callbackURL || '/')
    return this.renderAuthTemplate('sign-out', {
      auth: { callbackJs: escapedCallbackJs }
    })
  }

  /**
   * Render using an auth template
   */
  private renderAuthTemplate(name: string, data: Record<string, unknown>): string {
    let template = this.authTemplateCache.get(name)
    if (!template) {
      const source = authTemplates.get(name)
      if (!source) {
        throw new Error(`Auth template not found: ${name}`)
      }
      template = new StringTemplate(`auth:${name}`, 'liquid', this.builtinTemplateEngine.compile(source))
      this.authTemplateCache.set(name, template)
    }

    const context: RenderContext = {
      page: data.page ?? { title: '', path: '' },
      data: {},
      params: {},
      query: {},
      renderer: data.renderer as any,
      project: this.blueprint.project,
      theme: this.theme,
      auth: data.auth ?? {},
      ...data,
    } as any

    return template.render(context)
  }

  /**
   * Get login path from blueprint or default
   */
  private getLoginPath(): string {
    const explicit = this.blueprint.pages.find((page) => page.path.includes('sign-in') || page.path.includes('login'))
    return explicit?.path || '/auth/sign-in'
  }

  /**
   * Get signup path from blueprint or default
   */
  private getSignupPath(): string {
    const explicit = this.blueprint.pages.find((page) => page.path.includes('sign-up') || page.path.includes('register'))
    return explicit?.path || '/auth/sign-up'
  }

  /**
   * Get login action endpoint
   */
  private getLoginAction(): string {
    return '/api/auth/sign-in/email'
  }
}
