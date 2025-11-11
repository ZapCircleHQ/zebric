/**
 * Theme System
 *
 * Defines theme interface and default Tailwind-based theme.
 */

export interface Theme {
  name: string

  // Layout
  body: string
  container: string
  containerNarrow: string

  // Typography
  heading1: string
  heading2: string
  heading3: string
  textPrimary: string
  textSecondary: string

  // Navigation
  nav: string
  navContent: string
  navBrand: string
  navLinks: string
  navLink: string

  // Components
  card: string
  buttonPrimary: string
  buttonSecondary: string
  linkPrimary: string
  linkSecondary: string

  // Tables
  table: string
  tableHeader: string
  tableRow: string
  tableCell: string
  tableActions: string

  // Forms
  form: string
  formField: string
  formActions: string
  label: string
  input: string
  textarea: string
  select: string
  fileInput: string
  fieldError: string

  // States
  emptyState: string
  loadingState: string
  errorState: string

  // Page-specific
  pageHeader: string

  // Custom CSS (optional)
  customCSS?: string
}

export const defaultTheme: Theme = {
  name: 'default',

  // Layout
  body: 'bg-gray-50 text-gray-900 min-h-screen',
  container: 'container mx-auto px-4 py-8',
  containerNarrow: 'max-w-2xl',

  // Typography
  heading1: 'text-3xl font-bold text-gray-900 mb-6',
  heading2: 'text-2xl font-semibold text-gray-800 mb-4',
  heading3: 'text-xl font-medium text-gray-700 mb-3',
  textPrimary: 'text-gray-900',
  textSecondary: 'text-gray-600',

  // Navigation
  nav: 'bg-white shadow-sm border-b border-gray-200',
  navContent: 'flex justify-between items-center h-16',
  navBrand: 'text-xl font-bold text-gray-900 hover:text-gray-700',
  navLinks: 'flex space-x-6',
  navLink: 'text-gray-600 hover:text-gray-900 transition-colors',

  // Components
  card: 'bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden',
  buttonPrimary: 'px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors font-medium',
  buttonSecondary: 'px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors font-medium',
  linkPrimary: 'text-blue-600 hover:text-blue-800 transition-colors font-medium',
  linkSecondary: 'text-gray-600 hover:text-gray-800 transition-colors',

  // Tables
  table: 'min-w-full divide-y divide-gray-200',
  tableHeader: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50',
  tableRow: 'hover:bg-gray-50 transition-colors',
  tableCell: 'px-6 py-4 whitespace-nowrap text-sm text-gray-900',
  tableActions: 'space-x-3 text-right',

  // Forms
  form: 'bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6',
  formField: 'space-y-2',
  formActions: 'flex justify-end gap-3 pt-6 border-t border-gray-200',
  label: 'block text-sm font-medium text-gray-700',
  input: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow',
  textarea: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow resize-y',
  select: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow bg-white',
  fileInput: 'w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer',
  fieldError: 'text-sm text-red-600 mt-1',

  // States
  emptyState: 'text-center py-12 text-gray-500',
  loadingState: 'text-center py-12 text-gray-500 animate-pulse',
  errorState: 'text-center py-12 text-red-600 bg-red-50 border border-red-200 rounded-lg',

  // Page-specific
  pageHeader: 'flex justify-between items-center mb-6',
}

export const darkTheme: Theme = {
  ...defaultTheme,
  name: 'dark',

  // Override for dark mode
  body: 'bg-gray-900 text-gray-100 min-h-screen',
  card: 'bg-gray-800 rounded-lg shadow-sm border border-gray-700 overflow-hidden',
  nav: 'bg-gray-800 shadow-sm border-b border-gray-700',

  heading1: 'text-3xl font-bold text-gray-100 mb-6',
  heading2: 'text-2xl font-semibold text-gray-200 mb-4',
  heading3: 'text-xl font-medium text-gray-300 mb-3',

  navBrand: 'text-xl font-bold text-gray-100 hover:text-gray-300',
  navLink: 'text-gray-400 hover:text-gray-100 transition-colors',

  tableHeader: 'px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider bg-gray-800',
  tableRow: 'hover:bg-gray-700 transition-colors',
  tableCell: 'px-6 py-4 whitespace-nowrap text-sm text-gray-300',

  form: 'bg-gray-800 rounded-lg shadow-sm border border-gray-700 p-6 space-y-6',
  label: 'block text-sm font-medium text-gray-300',
  input: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow',
  textarea: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow resize-y',
  select: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow',

  emptyState: 'text-center py-12 text-gray-500',
  errorState: 'text-center py-12 text-red-400 bg-red-900/20 border border-red-800 rounded-lg',
}
