/**
 * Renderer Module
 *
 * Re-exports HTML rendering components from runtime-core.
 * Note: HTMLRenderer is now platform-agnostic and lives in runtime-core.
 */

// Re-export from core
export { HTMLRenderer, type RenderContext } from '@zebric/runtime-core'
export { type Theme, defaultTheme, darkTheme } from '@zebric/runtime-core'
export * from '@zebric/runtime-core'

// Node-specific template loader
export { FileTemplateLoader } from './file-template-loader.js'
