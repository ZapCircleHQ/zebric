/**
 * Blueprint Schema Validation
 *
 * Zod schemas for validating Blueprint JSON.
 */

import { z } from 'zod'
import { LookupConfigSchema } from '../controls/lookup/config.js'

const StringKeySchema = z.string()
const AnyRecordSchema = z.record(StringKeySchema, z.any())

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
    AnyRecordSchema,
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
  relations: z.record(StringKeySchema, RelationSchema).optional(),
  access: AccessRulesSchema.optional(),
  indexes: z.array(IndexSchema).optional(),
})

// ============================================================================
// Pages
// ============================================================================

const QuerySchema = z.object({
  entity: z.string(),
  where: AnyRecordSchema.optional(),
  orderBy: z.record(StringKeySchema, z.enum(['asc', 'desc'])).optional(),
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
    // Controls mountable as form fields — see controls/index.ts.
    'lookup',
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
  // Nested control config blocks. Each form-field-mountable control has its
  // config under a key matching its name — e.g., `[form.fields.<n>.lookup]`.
  lookup: LookupConfigSchema.optional(),
}).refine(
  (data) => data.type !== 'lookup' || data.lookup != null,
  { message: 'Form fields with type = "lookup" must include a [form.fields.<name>.lookup] block' }
)

// ============================================================================
// Zazzle UX Config
// ============================================================================

const UXPatternSchema = z.enum([
  'dashboard',
  'queue-detail',
  'data-table',
  'form-page',
  'approval-flow',
])

const UXPatternVersionSchema = z.string().refine(
  value => {
    const [pattern, version] = value.split('@')
    const validPattern = UXPatternSchema.safeParse(pattern).success
    return validPattern && (!version || /^v\d+$/.test(version))
  },
  'Expected a supported UX pattern, optionally versioned like "queue-detail@v1"'
)

const LayoutPrimitiveSchema = z.enum([
  'page',
  'header',
  'sidebar',
  'content',
  'panel',
  'section',
  'card',
  'table',
  'list',
  'detail',
  'activity',
  'form',
  'footer-actions',
])

const SemanticUIRoleSchema = z.enum([
  'primary-action',
  'secondary-action',
  'destructive-action',
  'status-positive',
  'status-warning',
  'status-negative',
  'status-neutral',
  'surface-default',
  'surface-elevated',
  'surface-muted',
  'feedback-success',
  'feedback-error',
  'feedback-loading',
])

const InteractionConfigSchema = z.object({
  selection: z.enum(['none', 'single', 'multi']).optional(),
  row_click: z.enum(['none', 'open-detail', 'select', 'edit']).optional(),
  edit_mode: z.enum(['inline', 'modal', 'page']).optional(),
  primary_action_position: z.enum(['header', 'sticky-footer', 'inline']).optional(),
  confirm_destructive: z.boolean().optional(),
})

const DataPresentationConfigSchema = z.object({
  mode: z.enum(['table', 'list', 'cards']).optional(),
  density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
  pagination: z.enum(['none', 'client', 'server']).optional(),
  filters: z.enum(['none', 'top-bar', 'sidebar']).optional(),
  column_config: z.boolean().optional(),
})

const FormInteractionConfigSchema = z.object({
  validation: z.enum(['inline', 'summary', 'none']).optional(),
  save_behavior: z.enum(['standard', 'optimistic']).optional(),
})

const FormSectionFieldSchema = z.object({
  name: z.string(),
})

const FormSectionSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  layout: z.enum(['single-column', 'two-column', 'inline', 'card-group']).optional(),
  fields: z.array(FormSectionFieldSchema),
})

const GlobalFormConfigSchema = z.object({
  mode: z.enum(['page', 'modal', 'inline']).optional(),
  sections: z.array(FormSectionSchema).optional(),
  interaction: FormInteractionConfigSchema.optional(),
})

const ExtensionConfigSchema = z.object({
  custom_view: z.string().optional(),
  placement: LayoutPrimitiveSchema.optional(),
})

const UXPatternConfigSchema = z.object({
  pattern: UXPatternVersionSchema,
  primitives: z.array(LayoutPrimitiveSchema).optional(),
  interaction: InteractionConfigSchema.optional(),
  data: DataPresentationConfigSchema.optional(),
  form: GlobalFormConfigSchema.optional(),
  roles: z.record(StringKeySchema, SemanticUIRoleSchema).optional(),
})

const PageUXConfigSchema = z.object({
  pattern: UXPatternVersionSchema.optional(),
  primitives: z.array(LayoutPrimitiveSchema).optional(),
  interaction: InteractionConfigSchema.optional(),
  data: DataPresentationConfigSchema.optional(),
  form: GlobalFormConfigSchema.optional(),
  roles: z.record(StringKeySchema, SemanticUIRoleSchema).optional(),
  extensions: z.array(ExtensionConfigSchema).optional(),
})

const UXConfigSchema = z.object({
  pattern: UXPatternVersionSchema.optional(),
  patterns: z.record(StringKeySchema, UXPatternConfigSchema).optional(),
  interaction: InteractionConfigSchema.optional(),
  data: DataPresentationConfigSchema.optional(),
  form: GlobalFormConfigSchema.optional(),
  system: z.object({
    feedback: z.object({
      success: z.enum(['toast', 'inline', 'banner']).optional(),
      error: z.enum(['toast', 'inline', 'banner']).optional(),
    }).optional(),
    activity: z.object({
      timeline: z.boolean().optional(),
      location: z.enum(['side-panel', 'main', 'hidden']).optional(),
    }).optional(),
  }).optional(),
  navigation: z.object({
    model: z.enum(['sidebar', 'topbar', 'none']).optional(),
    primary: z.array(z.string()).optional(),
  }).optional(),
  responsive: z.object({
    mode: z.enum(['desktop-first', 'mobile-first']).optional(),
    collapse_sidebar: z.boolean().optional(),
  }).optional(),
  extensions: z.array(ExtensionConfigSchema).optional(),
})

const FormSchema = z.object({
  entity: z.string(),
  method: z.enum(['create', 'update', 'delete']),
  fields: z.array(FormFieldSchema),
  mode: z.enum(['page', 'modal', 'inline']).optional(),
  sections: z.array(FormSectionSchema).optional(),
  interaction: FormInteractionConfigSchema.optional(),
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
  payload: AnyRecordSchema.optional(),
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

// ============================================================================
// Widgets
// ============================================================================

const WidgetActionSchema = z.object({
  update: AnyRecordSchema.optional(),
  workflow: z.string().optional(),
}).passthrough()

const WidgetCardToggleSchema = z.object({
  field: z.string(),
  label: z.string().optional(),
  label_on: z.string().optional(),
  label_off: z.string().optional(),
})

const WidgetCardSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  meta: z.array(z.string()).optional(),
  toggles: z.array(WidgetCardToggleSchema).optional(),
})

const WidgetSchema = z.object({
  kind: z.string(),
  entity: z.string(),
  group_by: z.string().optional(),
  column_entity: z.string().optional(),
  column_label: z.string().optional(),
  column_order: z.string().optional(),
  rank_field: z.string().optional(),
  card: WidgetCardSchema.optional(),
  on_move: WidgetActionSchema.optional(),
  on_edit: WidgetActionSchema.optional(),
  on_column_rename: WidgetActionSchema.optional(),
  on_toggle: WidgetActionSchema.optional(),
}).passthrough()

const PageSchema = z.object({
  path: z.string(),
  title: z.string(),
  auth: z.enum(['required', 'optional', 'none']).optional(),
  layout: z.string().optional(),
  widget: WidgetSchema.optional(),
  ux: PageUXConfigSchema.optional(),
  queries: z.record(StringKeySchema, QuerySchema).optional(),
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
  condition: AnyRecordSchema.optional(),
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

const ApiKeyConfigSchema = z.object({
  name: z.string(),
  keyEnv: z.string(),
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
  permissions: z.record(StringKeySchema, PermissionRuleSchema).optional(),
  apiKeys: z.array(ApiKeyConfigSchema).optional(),
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
  config: AnyRecordSchema.optional(),
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
  layouts: z.record(StringKeySchema, z.string()).optional(),
  components: z.record(StringKeySchema, z.string()).optional(),
})

const DesignAdapterConfigSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  roles: z.record(StringKeySchema, z.string()).optional(),
  tokens: z.object({
    colors: z.record(StringKeySchema, z.string()).optional(),
    typography: z.record(StringKeySchema, z.string()).optional(),
    spacing: z.record(StringKeySchema, z.string()).optional(),
    motion: z.record(StringKeySchema, z.string()).optional(),
  }).optional(),
})

// ============================================================================
// Notifications
// ============================================================================

const NotificationAdapterConfigSchema = z.object({
  name: z.string(),
  type: z.string(),
  config: AnyRecordSchema.optional(),
})

const NotificationsConfigSchema = z.object({
  default: z.string().optional(),
  adapters: z.array(NotificationAdapterConfigSchema),
})

// ============================================================================
// Skills (Agent-facing API)
// ============================================================================

const SkillActionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string(),
  body: z.record(StringKeySchema, z.string()).optional(),
  entity: z.string().optional(),
  action: z.enum(['create', 'list', 'get', 'update', 'delete']).optional(),
  mapParams: z.record(StringKeySchema, z.string()).optional(),
  workflow: z.string().optional(),
})

const SkillConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  auth: z.enum(['required', 'none']).optional(),
  actions: z.array(SkillActionSchema),
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
  ux: UXConfigSchema.optional(),
  design_adapter: DesignAdapterConfigSchema.optional(),
  notifications: NotificationsConfigSchema.optional(),
  skills: z.array(SkillConfigSchema).optional(),
})

export type BlueprintSchemaType = z.infer<typeof BlueprintSchema>
