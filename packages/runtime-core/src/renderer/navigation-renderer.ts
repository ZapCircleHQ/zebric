import type { Blueprint } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { escapeHtml, escapeHtmlAttr, SafeHtml, safe } from '../security/html-escape.js'

export function renderNavigation(
  blueprint: Blueprint,
  theme: Theme,
  session?: any,
  currentPath: string = '/'
): SafeHtml {
  const navigation = blueprint.ux?.navigation
  const navigationModel = navigation?.model || 'topbar'
  if (navigationModel === 'none') {
    return safe('')
  }

  const navPages = resolveNavPages(blueprint)
  const navItems = navPages
    .map((p) => {
      const isCurrent = currentPath === p.path
      return `
        <a
          href="${escapeHtmlAttr(p.path)}"
          class="${theme.navLink}"
          ${isCurrent ? 'aria-current="page"' : ''}
        >
          ${escapeHtml(p.title)}
        </a>
      `
    }) || []

  const notificationPath = resolveNotificationPath(blueprint)
  const notificationControl = session && notificationPath
    ? `
      <a
        href="${escapeHtmlAttr(notificationPath)}"
        class="zb-nav-action"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
          <path d="M10 21h4"></path>
        </svg>
      </a>
    `
    : ''

  const colorModeControl = `
    <button
      type="button"
      class="zb-nav-action"
      data-zebric-color-mode-control
      aria-label="Color mode: Auto"
      title="Color mode: Auto"
    >
      <svg data-zebric-color-mode-icon="auto" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="8"></circle><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"></path>
      </svg>
      <svg data-zebric-color-mode-icon="light" hidden aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>
      </svg>
      <svg data-zebric-color-mode-icon="dark" hidden aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"></path>
      </svg>
      <span class="sr-only" data-zebric-color-mode-label>Auto</span>
    </button>
  `

  const authControl = session
    ? `
      <div class="zb-nav-account">
        <span class="zb-nav-username">${escapeHtml(session.user?.name || session.user?.email || 'Signed in')}</span>
        <a
          href="/auth/sign-out?callbackURL=${encodeURIComponent(currentPath || '/')}"
          class="zb-nav-auth ${theme.linkSecondary}"
          aria-label="Sign out"
        >
          Sign out
        </a>
      </div>
    `
    : `
      <a
        href="/auth/sign-in?callbackURL=${encodeURIComponent(currentPath || '/')}"
        class="zb-nav-auth ${theme.linkPrimary}"
        aria-label="Sign in to your account"
      >
        Sign in
      </a>
    `

  const sidebarClasses = navigationModel === 'sidebar'
    ? 'md:sticky md:top-0 md:z-20'
    : ''
  const navContentClasses = navigationModel === 'sidebar'
    ? `${theme.navContent} flex-col items-start gap-4 md:flex-row md:items-center`
    : theme.navContent
  const navLinksClasses = navigationModel === 'sidebar'
    ? `${theme.navLinks} flex flex-wrap items-center gap-4`
    : `${theme.navLinks} flex items-center gap-4`

  return safe(`
    <nav
      aria-label="Primary navigation"
      class="${theme.nav} ${sidebarClasses}"
      data-zebric-navigation-model="${escapeHtmlAttr(navigationModel)}"
    >
      <div class="${theme.container}">
        <div class="${navContentClasses}">
          <a
            href="/"
            class="${theme.navBrand}"
            aria-label="${escapeHtmlAttr(blueprint.project.name)} home"
          >
            ${escapeHtml(blueprint.project.name)}
          </a>
          <div class="${navLinksClasses}">
            ${navItems.join('')}
            <div class="zb-nav-actions" aria-label="Application actions">
              ${notificationControl}
              ${colorModeControl}
              ${authControl}
            </div>
          </div>
        </div>
      </div>
    </nav>
  `)
}

/** Find an app-owned page suitable for notifications bubbled up to the user. */
export function resolveNotificationPath(blueprint: Blueprint): string | undefined {
  const pages = blueprint.pages?.filter(page => !page.path.includes(':')) ?? []
  const preferredPaths = ['/notifications', '/inbox', '/activity']
  for (const path of preferredPaths) {
    const match = pages.find(page => page.path.toLowerCase() === path)
    if (match) return match.path
  }

  const preferredTitles = ['notifications', 'inbox', 'activity']
  for (const title of preferredTitles) {
    const match = pages.find(page => page.title.toLowerCase() === title)
    if (match) return match.path
  }
  return undefined
}

export function resolveNavPages(blueprint: Blueprint): Array<{ path: string; title: string }> {
  const navigablePages = blueprint.pages
    ?.filter((p) => !p.path.includes(':'))
    ?.slice(0, 8) || []
  const primary = blueprint.ux?.navigation?.primary

  if (!primary?.length) {
    return navigablePages.filter((p) => p.path !== '/').slice(0, 5)
  }

  return primary
    .map((label) => {
      const normalized = label.toLowerCase()
      if (normalized === blueprint.project.name.toLowerCase()) {
        return { path: '/', title: label }
      }
      return navigablePages.find((page) => page.title.toLowerCase() === normalized)
        || navigablePages.find((page) => page.path.replace(/^\//, '').toLowerCase() === normalized.toLowerCase())
        || null
    })
    .filter((page): page is { path: string; title: string } => Boolean(page))
}
