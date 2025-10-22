import { describe, it, expect } from 'vitest'
import { RouteHandler } from '../../../src/server/route-handler.js'
import type { Blueprint, Form } from '../../../src/types/blueprint.js'

describe('RouteHandler - File Field Validation', () => {
  describe('validateForm with file fields', () => {
    it('should validate required file field', () => {
      const handler = new RouteHandler()

      const form: Form = {
        entity: 'Document',
        method: 'create',
        fields: [
          {
            name: 'file',
            type: 'file',
            required: true,
          },
        ],
      }

      // Missing file
      const errors1 = (handler as any).validateForm(form, {})
      expect(errors1).toHaveLength(1)
      expect(errors1[0].field).toBe('file')
      expect(errors1[0].message).toContain('required')

      // File present (URL stored after upload)
      const errors2 = (handler as any).validateForm(form, {
        file: '/uploads/01HQZT123.pdf',
      })
      expect(errors2).toHaveLength(0)
    })

    it('should allow optional file field to be missing', () => {
      const handler = new RouteHandler()

      const form: Form = {
        entity: 'Document',
        method: 'create',
        fields: [
          {
            name: 'title',
            type: 'text',
            required: true,
          },
          {
            name: 'file',
            type: 'file',
            required: false,
          },
        ],
      }

      const errors = (handler as any).validateForm(form, {
        title: 'Test Document',
      })

      expect(errors).toHaveLength(0)
    })

    it('should validate file field with other fields', () => {
      const handler = new RouteHandler()

      const form: Form = {
        entity: 'Document',
        method: 'create',
        fields: [
          {
            name: 'title',
            type: 'text',
            required: true,
          },
          {
            name: 'description',
            type: 'textarea',
            required: false,
          },
          {
            name: 'file',
            type: 'file',
            required: true,
          },
        ],
      }

      // Missing both title and file
      const errors1 = (handler as any).validateForm(form, {})
      expect(errors1.length).toBeGreaterThanOrEqual(2)

      // Has title but missing file
      const errors2 = (handler as any).validateForm(form, {
        title: 'Test',
      })
      expect(errors2).toHaveLength(1)
      expect(errors2[0].field).toBe('file')

      // Has file but missing title
      const errors3 = (handler as any).validateForm(form, {
        file: '/uploads/test.pdf',
      })
      expect(errors3).toHaveLength(1)
      expect(errors3[0].field).toBe('title')

      // Has both
      const errors4 = (handler as any).validateForm(form, {
        title: 'Test',
        file: '/uploads/test.pdf',
      })
      expect(errors4).toHaveLength(0)
    })
  })

  describe('hasFileFields', () => {
    it('should detect form with file fields', () => {
      const handler = new RouteHandler()

      const formWithFile: Form = {
        entity: 'Document',
        method: 'create',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'file', type: 'file' },
        ],
      }

      const result = (handler as any).hasFileFields(formWithFile)
      expect(result).toBe(true)
    })

    it('should return false for form without file fields', () => {
      const handler = new RouteHandler()

      const formWithoutFile: Form = {
        entity: 'Post',
        method: 'create',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'content', type: 'textarea' },
          { name: 'status', type: 'select', options: ['draft', 'published'] },
        ],
      }

      const result = (handler as any).hasFileFields(formWithoutFile)
      expect(result).toBe(false)
    })

    it('should detect multiple file fields', () => {
      const handler = new RouteHandler()

      const formWithMultipleFiles: Form = {
        entity: 'Document',
        method: 'create',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'document', type: 'file' },
          { name: 'thumbnail', type: 'file' },
        ],
      }

      const result = (handler as any).hasFileFields(formWithMultipleFiles)
      expect(result).toBe(true)
    })
  })
})
