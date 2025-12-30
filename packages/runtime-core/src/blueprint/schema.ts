/**
 * Blueprint Schema Validation
 *
 * Zod schemas for validating Blueprint JSON.
 */

import { z } from 'zod'

// ============================================================================
// Field Types
// ============================================================================

const FieldTypeSchema = z.enum([
  'ULID',
  'UUID',
  'Text',
  'LongText',
  'Email',
  'Integer',
  'Float',
  'Boolean',
  'DateTime',
  'Date',
  'JSON',
  'Enum',
  'Ref',
])

const FieldSchema = z.object({
  name: z.string(),
  type: FieldTypeSchema,
  primary_key: z.boolean().optional(),
  unique: z.boolean().optional(),
  index: z.boolean().optional(),
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
  default: z.any().optional(),
  values: z.array(z.string()).optional(), // For Enum
  ref: z.string().optional(), // For Ref
  access: z.lazy(() => FieldAccessRulesSchema).optional(), // For field-level access control
})

// ============================================================================
// Relations
// ============================================================================

const RelationSchema = z.object({
  type: z.enum(['hasMany', 'hasOne', 'belongsTo', 'manyToMany']),
  entity: z.string(),
  foreign_key: z.string().optional(),
  through: z.string().optional(),
})

// ============================================================================
// Access Rules
// ============================================================================

const AccessConditionSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.record(z.any()),
    z.object({
      or: z.array(AccessConditionSchema),
    }),
    z.object({
      and: z.array(AccessConditionSchema),
    }),
  ])
)

const AccessRulesSchema = z.object({
  read: AccessConditionSchema.optional(),
  create: AccessConditionSchema.optional(),
  update: AccessConditionSchema.optional(),
  delete: AccessConditionSchema.optional(),
})

const FieldAccessRulesSchema = z.object({
  read: AccessConditionSchema.optional(),
  write: AccessConditionSchema.optional(),
})

// ============================================================================
// Entities
// ============================================================================

const IndexSchema = z.object({
  fields: z.array(z.string()),
  unique: z.boolean().optional(),
  name: z.string().optional(),
})

const EntitySchema = z.object({
  name: z.string(),
  fields: z.array(FieldSchema),
  relations: z.record(RelationSchema).optional(),
  access: AccessRulesSchema.optional(),
  indexes: z.array(IndexSchema).optional(),
})

// ============================================================================
// Pages
// ============================================================================

const QuerySchema = z.object({
  entity: z.string(),
  where: z.record(z.any()).optional(),
  orderBy: z.record(z.enum(['asc', 'desc'])).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  include: z.array(z.string()).optional(),
})

const FormFieldSchema = z.object({
  name: z.string(),
  type: z.enum([
    'text',
    'textarea',
    'email',
    'password',
    'number',
    'select',
    'checkbox',
    'radio',
    'file',
    'date',
    'datetime',
  ]),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  default: z.any().optional(),
  options: z.array(z.any()).optional(),
  rows: z.number().optional(),
  accept: z.array(z.string()).optional(),
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  error_message: z.string().optional(),
})

const FormSchema = z.object({
  entity: z.string(),
  method: z.enum(['create', 'update', 'delete']),
  fields: z.array(FormFieldSchema),
  onSuccess: z
    .object({
      redirect: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
  onError: z
    .object({
      message: z.string().optional(),
    })
    .optional(),
})

const PageMetaSchema = z.object({
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  og_image: z.string().optional(),
})

const PageBehaviorSchema = z.object({
  intent: z.string().optional(),
  render: z.string().optional(),
}).passthrough() // Allow additional behavior handlers like on_status_click

const ActionBarActionSchema = z.object({
  label: z.string(),
  href: z.string().optional(),
  method: z.enum(['GET', 'POST']).optional(),
  style: z.enum(['primary', 'secondary', 'danger', 'ghost']).optional(),
  confirm: z.string().optional(),
  target: z.enum(['_self', '_blank']).optional(),
  icon: z.string().optional(),
  workflow: z.string().optional(),
  payload: z.record(z.any()).optional(),
  redirect: z.string().optional(),
  successMessage: z.string().optional(),
  errorMessage: z.string().optional(),
})

const ActionBarSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  statusField: z.string().optional(),
  statusLabel: z.string().optional(),
  showStatus: z.boolean().optional(),
  actions: z.array(ActionBarActionSchema).optional(),
  secondaryActions: z.array(ActionBarActionSchema).optional(),
})

const PageSchema = z.object({
  path: z.string(),
  title: z.string(),
  auth: z.enum(['required', 'optional', 'none']).optional(),
  layout: z.string(),
  queries: z.record(QuerySchema).optional(),
  form: FormSchema.optional(),
  meta: PageMetaSchema.optional(),
  behavior: PageBehaviorSchema.optional(),
  actionBar: ActionBarSchema.optional(),
})

// ============================================================================
// Workflows
// ============================================================================

const WorkflowTriggerSchema = z.object({
  entity: z.string().optional(),
  event: z.enum(['create', 'update', 'delete']).optional(),
  condition: z.record(z.any()).optional(),
  webhook: z.string().optional(),
  schedule: z.string().optional(),
  manual: z.boolean().optional(),
})

const WorkflowStepSchema = z.object({
  type: z.string(),
}).passthrough() // Allow additional properties

const WorkflowSchema = z.object({
  name: z.string(),
  trigger: WorkflowTriggerSchema,
  steps: z.array(WorkflowStepSchema),
})

// ============================================================================
// Auth
// ============================================================================

const PermissionConditionSchema = z.object({
  entity: z.string(),
  actions: z.array(z.string()),
  condition: AccessConditionSchema,
})

const PermissionRuleSchema = z.object({
  allow: z.union([z.array(z.string()), z.array(PermissionConditionSchema)]),
  deny: z.array(z.string()).optional(),
})

const AuthConfigSchema = z.object({
  providers: z.array(z.string()),
  trustedOrigins: z.array(z.string()).optional(),
  session: z
    .object({
      duration: z.number().optional(),
      idle_timeout: z.number().optional(),
    })
    .optional(),
  permissions: z.record(PermissionRuleSchema).optional(),
})

// ============================================================================
// Plugins
// ============================================================================

const PluginConfigSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  enabled: z.boolean(),
  trust_level: z.enum(['limited', 'full']).optional(),
  capabilities: z.array(z.enum(['database', 'network', 'storage', 'filesystem'])).optional(),
  config: z.record(z.any()).optional(),
})

// ============================================================================
// UI Config
// ============================================================================

const TailwindConfigSchema = z.object({
  primary_color: z.string().optional(),
  secondary_color: z.string().optional(),
  font_family: z.string().optional(),
}).passthrough()

const UIConfigSchema = z.object({
  render_mode: z.enum(['server', 'hybrid', 'spa']).optional(),
  theme: z.string().optional(),
  progressive_enhancement: z.enum(['none', 'alpine', 'htmx']).optional(),
  view_transitions: z.boolean().optional(),
  tailwind: TailwindConfigSchema.optional(),
  css: z
    .object({
      file: z.string().optional(),
    })
    .optional(),
  layouts: z.record(z.string()).optional(),
  components: z.record(z.string()).optional(),
})

// ============================================================================
// Notifications
// ============================================================================

const NotificationAdapterConfigSchema = z.object({
  name: z.string(),
  type: z.string(),
  config: z.record(z.any()).optional(),
})

const NotificationsConfigSchema = z.object({
  default: z.string().optional(),
  adapters: z.array(NotificationAdapterConfigSchema),
})

// ============================================================================
// Main Blueprint Schema
// ============================================================================

const ProjectConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  runtime: z.object({
    min_version: z.string(),
  }),
})

export const BlueprintSchema = z.object({
  version: z.string(),
  hash: z.string().optional(),
  project: ProjectConfigSchema,
  entities: z.array(EntitySchema),
  pages: z.array(PageSchema),
  workflows: z.array(WorkflowSchema).optional(),
  auth: AuthConfigSchema.optional(),
  plugins: z.array(PluginConfigSchema).optional(),
  ui: UIConfigSchema.optional(),
  notifications: NotificationsConfigSchema.optional(),
})

export type BlueprintSchemaType = z.infer<typeof BlueprintSchema>
