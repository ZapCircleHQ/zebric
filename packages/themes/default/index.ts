/**
 * Default Theme
 */

export const defaultTheme = {
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
  nav: 'bg-white shadow',
  navContent: 'flex justify-between items-center h-16',
  navBrand: 'text-xl font-bold text-gray-900',
  navLinks: 'flex space-x-6',
  navLink: 'text-gray-600 hover:text-gray-900 transition-colors',

  // Components
  card: 'bg-white rounded-lg shadow overflow-hidden',
  buttonPrimary: 'px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors',
  buttonSecondary: 'px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors',
  linkPrimary: 'text-blue-600 hover:text-blue-800 transition-colors',
  linkSecondary: 'text-gray-600 hover:text-gray-800 transition-colors',

  // Tables
  table: 'min-w-full divide-y divide-gray-200',
  tableHeader: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50',
  tableRow: 'hover:bg-gray-50 transition-colors',
  tableCell: 'px-6 py-4 whitespace-nowrap text-sm text-gray-900',
  tableActions: 'space-x-3',

  // Forms
  form: 'bg-white rounded-lg shadow p-6 space-y-6',
  formField: 'space-y-2',
  formActions: 'flex justify-end gap-3 pt-6',
  label: 'block text-sm font-medium text-gray-700',
  input: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow',
  textarea: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow resize-y',
  select: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow',
  fileInput: 'w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100',
  fieldError: 'text-sm text-red-600 mt-1 hidden',

  // States
  emptyState: 'text-center py-12 text-gray-500',
  loadingState: 'text-center py-12 text-gray-500 animate-pulse',
  errorState: 'text-center py-12 text-red-600',

  // Page-specific
  pageHeader: 'flex justify-between items-center mb-6'
}
