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
  ux?: UXConfig
  design_adapter?: DesignAdapterConfig
  notifications?: NotificationsConfig
  skills?: SkillConfig[]
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
  | string
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
  layout?: 'list' | 'detail' | 'form' | string
  widget?: Widget
  ux?: PageUXConfig
  queries?: Record<string, Query>
  form?: Form
  meta?: PageMeta
  behavior?: PageBehavior
  template?: PageTemplate
  layoutSlots?: Record<string, PageTemplate>
  actionBar?: ActionBarConfig
}

// ============================================================================
// Widgets
// ============================================================================

export interface Widget {
  kind: string
  entity: string
  group_by?: string
  column_entity?: string
  column_label?: string
  column_order?: string
  rank_field?: string
  card?: WidgetCard
  on_move?: WidgetAction
  on_edit?: WidgetAction
  on_column_rename?: WidgetAction
  on_toggle?: WidgetAction
  [key: string]: any
}

export interface WidgetCard {
  title?: string
  subtitle?: string
  meta?: string[]
  toggles?: WidgetCardToggle[]
}

export interface WidgetCardToggle {
  field: string
  label?: string
  label_on?: string
  label_off?: string
}

export interface WidgetAction {
  update?: Record<string, any>
  workflow?: string
  [key: string]: any
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

export interface ActionBarConfig {
  title?: string
  description?: string
  statusField?: string
  statusLabel?: string
  showStatus?: boolean
  actions?: ActionBarAction[]
  secondaryActions?: ActionBarAction[]
}

export interface ActionBarAction {
  label: string
  href?: string
  method?: 'GET' | 'POST'
  style?: 'primary' | 'secondary' | 'danger' | 'ghost'
  confirm?: string
  target?: '_self' | '_blank'
  icon?: string
  workflow?: string
  payload?: Record<string, any>
  redirect?: string
  successMessage?: string
  errorMessage?: string
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
  mode?: FormMode
  sections?: FormSection[]
  interaction?: FormInteractionConfig
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

// ============================================================================
// Zazzle UX Configuration
// ============================================================================

export type UXPattern =
  | 'dashboard'
  | 'queue-detail'
  | 'data-table'
  | 'form-page'
  | 'approval-flow'

export type UXPatternVersion =
  | UXPattern
  | `${UXPattern}@v${number}`

export type LayoutPrimitive =
  | 'page'
  | 'header'
  | 'sidebar'
  | 'content'
  | 'panel'
  | 'section'
  | 'card'
  | 'table'
  | 'list'
  | 'detail'
  | 'activity'
  | 'form'
  | 'footer-actions'

export type SemanticUIRole =
  | 'primary-action'
  | 'secondary-action'
  | 'destructive-action'
  | 'status-positive'
  | 'status-warning'
  | 'status-negative'
  | 'status-neutral'
  | 'surface-default'
  | 'surface-elevated'
  | 'surface-muted'
  | 'feedback-success'
  | 'feedback-error'
  | 'feedback-loading'

export interface UXConfig {
  pattern?: UXPatternVersion
  patterns?: Record<string, UXPatternConfig>
  interaction?: InteractionConfig
  data?: DataPresentationConfig
  form?: GlobalFormConfig
  system?: SystemUXConfig
  navigation?: NavigationConfig
  responsive?: ResponsiveConfig
  extensions?: ExtensionConfig[]
}

export interface PageUXConfig {
  pattern?: UXPatternVersion
  primitives?: LayoutPrimitive[]
  interaction?: InteractionConfig
  data?: DataPresentationConfig
  form?: GlobalFormConfig
  roles?: Record<string, SemanticUIRole>
  extensions?: ExtensionConfig[]
}

export interface UXPatternConfig {
  pattern: UXPatternVersion
  primitives?: LayoutPrimitive[]
  interaction?: InteractionConfig
  data?: DataPresentationConfig
  form?: GlobalFormConfig
  roles?: Record<string, SemanticUIRole>
}

export interface InteractionConfig {
  selection?: 'none' | 'single' | 'multi'
  row_click?: 'none' | 'open-detail' | 'select' | 'edit'
  edit_mode?: 'inline' | 'modal' | 'page'
  primary_action_position?: 'header' | 'sticky-footer' | 'inline'
  confirm_destructive?: boolean
}

export interface DataPresentationConfig {
  mode?: 'table' | 'list' | 'cards'
  density?: 'compact' | 'comfortable' | 'spacious'
  pagination?: 'none' | 'client' | 'server'
  filters?: 'none' | 'top-bar' | 'sidebar'
  column_config?: boolean
}

export type FormMode = 'page' | 'modal' | 'inline'
export type FormSectionLayout = 'single-column' | 'two-column' | 'inline' | 'card-group'

export interface GlobalFormConfig {
  mode?: FormMode
  sections?: FormSection[]
  interaction?: FormInteractionConfig
}

export interface FormSection {
  title?: string
  description?: string
  layout?: FormSectionLayout
  fields: FormSectionField[]
}

export interface FormSectionField {
  name: string
}

export interface FormInteractionConfig {
  validation?: 'inline' | 'summary' | 'none'
  save_behavior?: 'standard' | 'optimistic'
}

export interface SystemUXConfig {
  feedback?: {
    success?: 'toast' | 'inline' | 'banner'
    error?: 'toast' | 'inline' | 'banner'
  }
  activity?: {
    timeline?: boolean
    location?: 'side-panel' | 'main' | 'hidden'
  }
}

export interface NavigationConfig {
  model?: 'sidebar' | 'topbar' | 'none'
  primary?: string[]
}

export interface ResponsiveConfig {
  mode?: 'desktop-first' | 'mobile-first'
  collapse_sidebar?: boolean
}

export interface ExtensionConfig {
  custom_view?: string
  placement?: LayoutPrimitive
}

export interface DesignAdapterConfig {
  name?: string
  version?: string
  roles?: Partial<Record<SemanticUIRole, string>>
  tokens?: {
    colors?: Record<string, string>
    typography?: Record<string, string>
    spacing?: Record<string, string>
    motion?: Record<string, string>
  }
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
  entity?: string
  event?: 'create' | 'update' | 'delete'
  condition?: Record<string, any>
  webhook?: string
  schedule?: string
  manual?: boolean
}

export interface WorkflowStep {
  type: 'email' | 'webhook' | 'plugin' | 'delay' | 'condition' | 'notify'
  [key: string]: any
}

// ============================================================================
// Auth
// ============================================================================

export interface ApiKeyConfig {
  name: string
  keyEnv: string
}

export interface AuthConfig {
  providers: string[]
  trustedOrigins?: string[]
  session?: {
    duration?: number
    idle_timeout?: number
  }
  permissions?: Record<string, PermissionRule>
  apiKeys?: ApiKeyConfig[]
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
// Skills (Agent-facing API)
// ============================================================================

export interface SkillAction {
  name: string
  description?: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: Record<string, string>
  entity?: string
  action?: 'create' | 'list' | 'get' | 'update' | 'delete'
  mapParams?: Record<string, string>
  workflow?: string
}

export interface SkillConfig {
  name: string
  description?: string
  auth?: 'required' | 'none'
  actions: SkillAction[]
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
