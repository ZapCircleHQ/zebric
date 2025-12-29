/**
 * Blueprint Types
 *
 * TypeScript types for the Blueprint JSON schema.
 * These define the structure of a Zebric application.
 */

export interface Blueprint {
  version: string
  hash?: string
  project: ProjectConfig
  entities: Entity[]
  pages: Page[]
  workflows?: Workflow[]
  auth?: AuthConfig
  plugins?: PluginConfig[]
  ui?: UIConfig
  notifications?: NotificationsConfig
}

export interface ProjectConfig {
  name: string
  version: string
  description?: string
  runtime: {
    min_version: string
  }
}

// ============================================================================
// Entities
// ============================================================================

export interface Entity {
  name: string
  fields: Field[]
  relations?: Record<string, Relation>
  access?: AccessRules
  indexes?: Index[]
}

export interface Field {
  name: string
  type: FieldType
  primary_key?: boolean
  unique?: boolean
  index?: boolean
  required?: boolean
  nullable?: boolean
  default?: any
  values?: string[] // For Enum type
  ref?: string // For Ref type (e.g., "User.id")
  access?: FieldAccessRules
}

export type FieldType =
  | 'ULID'
  | 'UUID'
  | 'Text'
  | 'LongText'
  | 'Email'
  | 'Integer'
  | 'Float'
  | 'Boolean'
  | 'DateTime'
  | 'Date'
  | 'JSON'
  | 'Enum'
  | 'Ref'

export interface Relation {
  type: 'hasMany' | 'hasOne' | 'belongsTo' | 'manyToMany'
  entity: string
  foreign_key?: string
  through?: string // For many-to-many
}

export interface Index {
  fields: string[]
  unique?: boolean
  name?: string
}

export interface AccessRules {
  read?: AccessCondition
  create?: AccessCondition
  update?: AccessCondition
  delete?: AccessCondition
}

export interface FieldAccessRules {
  read?: AccessCondition
  write?: AccessCondition
}

export type AccessCondition =
  | boolean
  | { [key: string]: any }
  | { or: AccessCondition[] }
  | { and: AccessCondition[] }

// ============================================================================
// Pages
// ============================================================================

export interface Page {
  path: string
  title: string
  auth?: 'required' | 'optional' | 'none'
  layout: 'list' | 'detail' | 'form' | string
  queries?: Record<string, Query>
  form?: Form
  meta?: PageMeta
  behavior?: PageBehavior
  template?: PageTemplate
  layoutSlots?: Record<string, PageTemplate>
}

export interface PageTemplate {
  engine?: 'handlebars' | 'liquid'
  source: string // File path or inline template content
  type?: 'file' | 'inline' // How to load the template (default: 'file')
}

// ============================================================================
// Layout Slots
// ============================================================================

/**
 * Valid slot names for the list layout
 */
export type ListLayoutSlot = 'list.header' | 'list.body' | 'list.empty'

/**
 * Valid slot names for the detail layout
 */
export type DetailLayoutSlot = 'detail.main' | 'detail.related'

/**
 * Valid slot names for the form layout
 */
export type FormLayoutSlot = 'form.form'

/**
 * Valid slot names for the dashboard layout
 */
export type DashboardLayoutSlot = 'dashboard.widgets'

/**
 * Union of all valid layout slot names
 */
export type LayoutSlotName =
  | ListLayoutSlot
  | DetailLayoutSlot
  | FormLayoutSlot
  | DashboardLayoutSlot

/**
 * Type-safe layoutSlots with proper slot name validation
 */
export type LayoutSlots = Partial<Record<LayoutSlotName, PageTemplate>>

export interface PageBehavior {
  intent?: string  // Natural language description of desired behavior
  render?: string  // Path to JavaScript file that renders the page
  [key: string]: any  // Additional behavior handlers (e.g., on_status_click)
}

export interface Query {
  entity: string
  where?: Record<string, any>
  orderBy?: Record<string, 'asc' | 'desc'>
  limit?: number
  offset?: number
  include?: string[]
}

export interface Form {
  entity: string
  method: 'create' | 'update' | 'delete'
  fields: FormField[]
  onSuccess?: {
    redirect?: string
    message?: string
  }
  onError?: {
    message?: string
  }
}

export interface FormField {
  name: string
  type: 'text' | 'textarea' | 'email' | 'password' | 'number' | 'select' | 'checkbox' | 'radio' | 'file' | 'date' | 'datetime'
  label?: string
  placeholder?: string
  required?: boolean
  default?: any
  options?: any[]
  rows?: number // For textarea
  accept?: string[] // For file input
  pattern?: string
  min?: number
  max?: number
  error_message?: string
}

export interface PageMeta {
  description?: string
  keywords?: string[]
  og_image?: string
}

// ============================================================================
// Workflows
// ============================================================================

export interface Workflow {
  name: string
  trigger: WorkflowTrigger
  steps: WorkflowStep[]
}

export interface WorkflowTrigger {
  entity: string
  event: 'create' | 'update' | 'delete'
  condition?: Record<string, any>
}

export interface WorkflowStep {
  type: 'email' | 'webhook' | 'plugin' | 'delay' | 'condition' | 'notify'
  [key: string]: any
}

// ============================================================================
// Auth
// ============================================================================

export interface AuthConfig {
  providers: string[]
  trustedOrigins?: string[]
  session?: {
    duration?: number
    idle_timeout?: number
  }
  permissions?: Record<string, PermissionRule>
}

export interface PermissionRule {
  allow: string[] | PermissionCondition[]
  deny?: string[]
}

export interface PermissionCondition {
  entity: string
  actions: string[]
  condition: AccessCondition
}

// ============================================================================
// Plugins
// ============================================================================

export type PluginTrustLevel = 'limited' | 'full'

export type PluginCapability = 'database' | 'network' | 'storage' | 'filesystem'

export interface PluginConfig {
  name: string
  version?: string
  enabled: boolean
  trust_level?: PluginTrustLevel  // Default: 'limited' for safety
  capabilities?: PluginCapability[]  // Only used when trust_level='full'
  config?: Record<string, any>
}

// ============================================================================
// UI Configuration
// ============================================================================

export interface UIConfig {
  render_mode?: 'server' | 'hybrid' | 'spa'
  theme?: string
  progressive_enhancement?: 'none' | 'alpine' | 'htmx'
  view_transitions?: boolean
  tailwind?: TailwindConfig
  css?: {
    file?: string
  }
  layouts?: Record<string, string>
  components?: Record<string, string>
}

export interface TailwindConfig {
  primary_color?: string
  secondary_color?: string
  font_family?: string
  [key: string]: any
}

// ============================================================================
// Notifications
// ============================================================================

export interface NotificationsConfig {
  default?: string
  adapters: NotificationAdapterConfig[]
}

export interface NotificationAdapterConfig {
  name: string
  type: string
  config?: Record<string, any>
}
