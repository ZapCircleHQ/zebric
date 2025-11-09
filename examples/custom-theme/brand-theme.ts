/**
 * Brand Theme Example
 *
 * A custom theme with purple/pink gradient branding
 */

import type { Theme } from '@zebric/runtime-node'

export const brandTheme: Theme = {
  name: 'brand',

  // Layout
  body: 'bg-gradient-to-br from-purple-50 to-pink-50 text-gray-900 min-h-screen',
  container: 'container mx-auto px-6 py-10 max-w-7xl',
  containerNarrow: 'max-w-3xl',

  // Typography
  heading1: 'text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600 mb-8',
  heading2: 'text-3xl font-bold text-purple-900 mb-6',
  heading3: 'text-2xl font-semibold text-purple-800 mb-4',
  textPrimary: 'text-gray-900',
  textSecondary: 'text-gray-600',

  // Navigation
  nav: 'bg-white/80 backdrop-blur-md shadow-lg border-b border-purple-100',
  navContent: 'flex justify-between items-center h-20',
  navBrand: 'text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700',
  navLinks: 'flex space-x-8',
  navLink: 'text-gray-700 hover:text-purple-600 font-medium transition-colors',

  // Components
  card: 'bg-white rounded-2xl shadow-xl border border-purple-100 overflow-hidden hover:shadow-2xl transition-shadow',
  buttonPrimary: 'px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-pink-700 focus:outline-none focus:ring-4 focus:ring-purple-300 transition-all',
  buttonSecondary: 'px-6 py-3 border-2 border-purple-300 text-purple-700 rounded-xl font-semibold hover:bg-purple-50 focus:outline-none focus:ring-4 focus:ring-purple-200 transition-all',
  linkPrimary: 'text-purple-600 hover:text-pink-600 font-medium transition-colors underline-offset-4 hover:underline',
  linkSecondary: 'text-gray-600 hover:text-gray-900 transition-colors',

  // Tables
  table: 'min-w-full divide-y divide-purple-200',
  tableHeader: 'px-6 py-4 text-left text-xs font-bold text-purple-700 uppercase tracking-wider bg-purple-50',
  tableRow: 'hover:bg-purple-50 transition-colors border-b border-purple-100',
  tableCell: 'px-6 py-4 whitespace-nowrap text-sm text-gray-900',
  tableActions: 'space-x-4 text-right',

  // Forms
  form: 'bg-white rounded-2xl shadow-xl border border-purple-100 p-8 space-y-6',
  formField: 'space-y-2',
  formActions: 'flex justify-end gap-4 pt-8 border-t-2 border-purple-100',
  label: 'block text-sm font-bold text-purple-900 mb-2',
  input: 'w-full px-4 py-3 border-2 border-purple-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-purple-300 focus:border-purple-500 transition-all',
  textarea: 'w-full px-4 py-3 border-2 border-purple-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-purple-300 focus:border-purple-500 transition-all resize-y',
  select: 'w-full px-4 py-3 border-2 border-purple-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-purple-300 focus:border-purple-500 transition-all bg-white',
  fileInput: 'w-full text-sm text-gray-600 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-purple-100 file:text-purple-700 hover:file:bg-purple-200 cursor-pointer',
  fieldError: 'text-sm text-red-600 mt-2 font-medium',

  // States
  emptyState: 'text-center py-16 text-gray-500',
  loadingState: 'text-center py-16 text-purple-500 animate-pulse font-medium',
  errorState: 'text-center py-16 text-red-600 bg-red-50 border-2 border-red-200 rounded-2xl',

  // Page-specific
  pageHeader: 'flex justify-between items-center mb-8',

  // Add custom CSS for animations
  customCSS: `
    @keyframes gradient-shift {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .animated-gradient {
      background-size: 200% 200%;
      animation: gradient-shift 3s ease infinite;
    }
  `
}
