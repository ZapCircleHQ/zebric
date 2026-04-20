import type { Form, FormSection } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { html, SafeHtml, safe } from '../security/html-escape.js'

export type FormFieldRenderer = (field: Form['fields'][number], record: any) => string

export function renderFormFields(
  form: Form,
  record: any,
  theme: Theme,
  renderField: FormFieldRenderer
): SafeHtml {
  if (!form.sections?.length) {
    return safe(form.fields.map((field) => renderField(field, record)).join(''))
  }

  const fieldByName = new Map(form.fields.map(field => [field.name, field]))
  const renderedFieldNames = new Set<string>()

  const sections = form.sections.map(section => {
    const sectionFields = section.fields
      .map(fieldRef => fieldByName.get(fieldRef.name))
      .filter((field): field is Form['fields'][number] => Boolean(field))

    for (const field of sectionFields) {
      renderedFieldNames.add(field.name)
    }

    return renderFormSection(section, sectionFields, record, theme, renderField)
  })

  const unsectionedFields = form.fields.filter(field => !renderedFieldNames.has(field.name))
  const unsectioned = unsectionedFields.length > 0
    ? safe(unsectionedFields.map(field => renderField(field, record)).join(''))
    : safe('')

  return safe(`${sections.map(section => section.toString()).join('')}${unsectioned.toString()}`)
}

export function renderFormSection(
  section: FormSection,
  fields: Form['fields'],
  record: any,
  theme: Theme,
  renderField: FormFieldRenderer
): SafeHtml {
  const layoutClass = getFormSectionLayoutClass(section.layout)

  return html`
    <section class="space-y-4" data-zebric-primitive="section">
      ${section.title || section.description ? html`
        <div>
          ${section.title ? html`<h2 class="${theme.heading2}">${section.title}</h2>` : ''}
          ${section.description ? html`<p class="${theme.textSecondary}">${section.description}</p>` : ''}
        </div>
      ` : ''}
      <div class="${layoutClass}">
        ${safe(fields.map(field => renderField(field, record)).join(''))}
      </div>
    </section>
  `
}

export function getFormSectionLayoutClass(layout?: string): string {
  switch (layout) {
    case 'two-column':
      return 'grid grid-cols-1 gap-4 md:grid-cols-2'
    case 'inline':
      return 'flex flex-col gap-4 md:flex-row md:items-end'
    case 'card-group':
      return 'grid grid-cols-1 gap-4 md:grid-cols-2'
    default:
      return 'space-y-4'
  }
}
