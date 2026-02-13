/**
 * Renderer Utilities
 *
 * Utility functions for formatting, path resolution, and entity handling.
 */

import type { Blueprint, Page } from '../types/blueprint.js'

export class RendererUtils {
  constructor(private blueprint: Blueprint) {}

  /**
   * Get display fields from a record and entity definition
   */
  getDisplayFields(record: any, entity?: any): Array<{name: string, type: string}> {
    // If we have entity definition, use it
    if (entity?.fields) {
      return entity.fields
        .filter((f: any) => !['id', 'createdAt', 'updatedAt'].includes(f.name))
        .map((f: any) => ({ name: f.name, type: f.type }))
    }

    if (!record) return []

    // Otherwise infer from record
    return Object.keys(record)
      .filter(key => !['id', 'createdAt', 'updatedAt'].includes(key))
      .map(key => ({ name: key, type: typeof record[key] }))
  }

  /**
   * Format field name for display (camelCase -> Title Case)
   */
  formatFieldName(name: string): string {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim()
  }

  /**
   * Format value based on type
   */
  formatValue(value: any, type: string): string {
    if (value === null || value === undefined) return '-'

    switch (type) {
      case 'DateTime':
      case 'Date':
        return new Date(value).toLocaleDateString()

      case 'Boolean':
        return value ? '✓' : '✗'

      case 'JSON':
        return JSON.stringify(value, null, 2)

      default:
        return String(value)
    }
  }

  /**
   * Get the page path for a specific entity and page type
   */
  getEntityPagePath(entityName: string | undefined, type: 'create' | 'detail' | 'update' | 'delete' | 'list'): string | null {
    if (!entityName) return null

    const pages = this.blueprint.pages
    if (!pages) return null

    switch (type) {
      case 'create':
        return pages.find((page) => page.form?.entity === entityName && page.form.method === 'create')?.path || null
      case 'update':
        return pages.find((page) => page.form?.entity === entityName && page.form.method === 'update')?.path || null
      case 'delete':
        return pages.find((page) => page.form?.entity === entityName && page.form.method === 'delete')?.path || null
      case 'detail':
        return pages.find((page) => page.layout === 'detail' && this.pageTargetsEntity(page, entityName))?.path || null
      case 'list':
        {
          const candidates = pages.filter((page) => page.layout === 'list' && this.pageTargetsEntity(page, entityName))
          if (candidates.length === 0) return null
          const slug = this.slugify(entityName)
          const preferred = candidates.find((page) => page.path !== '/' && page.path.includes(slug))
          return (preferred ?? candidates[0]!).path
        }
      default:
        return null
    }
  }

  /**
   * Check if a page targets a specific entity
   */
  pageTargetsEntity(page: Page, entityName: string): boolean {
    if (page.queries && Object.values(page.queries).some((query) => query.entity === entityName)) {
      return true
    }
    if (page.form?.entity === entityName) {
      return true
    }
    return false
  }

  /**
   * Resolve entity link with template or fallback
   */
  resolveEntityLink(
    template: string | null | undefined,
    entityName: string | undefined,
    item: any,
    fallbackSuffix?: 'edit' | 'delete'
  ): string {
    if (template) {
      return this.interpolatePath(template, item)
    }

    const base = this.collectionPath(entityName || 'item')
    if (fallbackSuffix === 'edit') {
      return `${base}/${encodeURIComponent(item.id)}/edit`
    }
    if (fallbackSuffix === 'delete') {
      return `${base}/${encodeURIComponent(item.id)}/delete`
    }
    return `${base}/${encodeURIComponent(item.id)}`
  }

  /**
   * Interpolate path template with parameters
   */
  interpolatePath(pathTemplate: string, params: Record<string, any>): string {
    if (!pathTemplate) {
      return ''
    }

    const replaceToken = (template: string, regex: RegExp): string => {
      return template.replace(regex, (_, key) => {
        const value = params?.[key]
        return value === undefined || value === null ? '' : encodeURIComponent(String(value))
      })
    }

    // Support both :id and {id} style placeholders
    const withBraces = replaceToken(pathTemplate, /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)
    return replaceToken(withBraces, /:([a-zA-Z_][a-zA-Z0-9_]*)/g)
  }

  /**
   * Interpolate arbitrary text with {placeholders}
   */
  interpolateText(template: string, params?: Record<string, any>): string {
    if (!template) {
      return ''
    }

    return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (_, key) => {
      const value = this.getNestedValue(params, key)
      return value === undefined || value === null ? '' : String(value)
    })
  }

  private getNestedValue(source: Record<string, any> | undefined, path: string): any {
    if (!source || !path) {
      return undefined
    }

    return path.split('.').reduce<any>((acc, key) => {
      if (acc === undefined || acc === null) {
        return undefined
      }
      return acc[key]
    }, source)
  }

  /**
   * Convert string to slug format
   */
  slugify(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/\s+/g, '-')
      .toLowerCase()
  }

  /**
   * Get collection path for an entity
   */
  collectionPath(entityName: string): string {
    const slug = this.slugify(entityName)
    return `/${slug}${slug.endsWith('s') ? '' : 's'}`
  }

  /**
   * Resolve form record from data
   */
  resolveFormRecord(form: any, data?: Record<string, any> | null): any {
    if (!form || !data) return null

    const entityName: string | undefined = form.entity
    const candidates: Array<any> = []

    if (data.record !== undefined) {
      candidates.push(data.record)
    }

    if (entityName) {
      if (data[entityName] !== undefined) {
        candidates.push(data[entityName])
      }

      const lower = this.lowercaseFirst(entityName)
      if (lower && lower !== entityName && data[lower] !== undefined) {
        candidates.push(data[lower])
      }

      const slug = this.slugify(entityName)
      if (slug && slug !== entityName && data[slug] !== undefined) {
        candidates.push(data[slug])
      }
    }

    const direct = this.normalizeRecordCandidate(candidates.find((candidate) => candidate !== undefined))
    if (direct) {
      return direct
    }

    for (const value of Object.values(data)) {
      const normalized = this.normalizeRecordCandidate(value)
      if (normalized) {
        return normalized
      }
    }

    return null
  }

  /**
   * Normalize record candidate (handle arrays and objects)
   */
  normalizeRecordCandidate(value: any): any {
    if (!value) return null
    if (Array.isArray(value)) {
      return value.length > 0 ? value[0] : null
    }
    if (typeof value === 'object') {
      return value
    }
    return null
  }

  /**
   * Lowercase first character of a string
   */
  lowercaseFirst(value?: string): string | undefined {
    if (!value || value.length === 0) return value
    return value.charAt(0).toLowerCase() + value.slice(1)
  }
}
