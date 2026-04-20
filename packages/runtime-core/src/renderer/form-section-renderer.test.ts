import { describe, expect, it } from 'vitest'
import { defaultTheme } from './theme.js'
import {
  getFormSectionLayoutClass,
  renderFormFields,
  renderFormSection,
} from './form-section-renderer.js'
import type { Form } from '../types/blueprint.js'

const renderField = (field: Form['fields'][number]) => `<input name="${field.name}" />`

describe('form section renderer', () => {
  it('renders unsectioned fields unchanged', () => {
    const form: Form = {
      entity: 'Task',
      method: 'create',
      fields: [{ name: 'title', type: 'text' }],
    }

    expect(renderFormFields(form, {}, defaultTheme, renderField).toString()).toContain('name="title"')
  })

  it('renders configured sections and appends unsectioned fields', () => {
    const form: Form = {
      entity: 'Task',
      method: 'create',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'status', type: 'text' },
      ],
      sections: [
        {
          title: 'Basic Info',
          layout: 'two-column',
          fields: [{ name: 'title' }],
        },
      ],
    }

    const html = renderFormFields(form, {}, defaultTheme, renderField).toString()
    expect(html).toContain('Basic Info')
    expect(html).toContain('data-zebric-primitive="section"')
    expect(html).toContain('md:grid-cols-2')
    expect(html).toContain('name="title"')
    expect(html).toContain('name="status"')
  })

  it('renders section descriptions', () => {
    const html = renderFormSection(
      {
        title: 'Routing',
        description: 'Route the work.',
        fields: [{ name: 'status' }],
      },
      [{ name: 'status', type: 'text' }],
      {},
      defaultTheme,
      renderField
    ).toString()

    expect(html).toContain('Routing')
    expect(html).toContain('Route the work.')
  })

  it('maps form section layout classes', () => {
    expect(getFormSectionLayoutClass('two-column')).toContain('md:grid-cols-2')
    expect(getFormSectionLayoutClass('inline')).toContain('md:flex-row')
    expect(getFormSectionLayoutClass('single-column')).toBe('space-y-4')
  })
})
