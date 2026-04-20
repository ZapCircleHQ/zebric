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

  const authControl = session
    ? `
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500">${escapeHtml(session.user?.name || session.user?.email || 'Signed in')}</span>
        <a
          href="/auth/sign-out?callbackURL=${encodeURIComponent(currentPath || '/')}"
          class="${theme.linkSecondary}"
          aria-label="Sign out"
        >
          Sign out
        </a>
      </div>
    `
    : `
      <a
        href="/auth/sign-in?callbackURL=${encodeURIComponent(currentPath || '/')}"
        class="${theme.linkPrimary}"
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
            ${authControl}
          </div>
        </div>
      </div>
    </nav>
  `)
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
