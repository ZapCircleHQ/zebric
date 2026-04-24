/**
 * Lookup display-template formatter.
 *
 * Given a template like "{lastName}, {firstName}" and a record, substitute
 * `{fieldName}` tokens with the record's field values. Falls back to the
 * first search field (or `name`/`title`/`id`) when no template is provided.
 */

const TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g

export function formatDisplay(
  record: Record<string, any>,
  template?: string,
  fallbackFields?: string[]
): string {
  if (template) {
    return template.replace(TOKEN, (_, field) => {
      const v = record?.[field]
      return v == null ? '' : String(v)
    }).trim()
  }

  const candidates = [
    ...(fallbackFields ?? []),
    'name', 'title', 'label', 'id',
  ]
  for (const field of candidates) {
    const v = record?.[field]
    if (v != null && v !== '') return String(v)
  }
  return ''
}
