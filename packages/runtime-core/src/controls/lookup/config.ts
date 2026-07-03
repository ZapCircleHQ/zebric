/**
 * Lookup control — config schema.
 *
 * Shared between form-field mount (`[[form.fields]] type = "lookup"` +
 * `[form.fields.<name>.lookup]`) and widget mount (`[page.X.widget]
 * kind = "lookup"`).
 */

import { z } from 'zod'

export const LookupConfigSchema = z.object({
  entity: z.string(),
  search: z.array(z.string()).min(1),
  display: z.string().optional(),      // template like "{lastName}, {firstName}"
  limit: z.number().int().positive().max(100).optional(),
  placeholder: z.string().optional(),
  filter: z.record(z.string(), z.any()).optional(),
}).passthrough()

export type LookupConfig = z.infer<typeof LookupConfigSchema>
