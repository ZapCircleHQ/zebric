/**
 * Control types.
 *
 * A "control" is an interactive input or view that can appear at two mount
 * points: inside a form field (`[[form.fields]] type = "lookup"`) or as a
 * page-level widget (`[page.X.widget] kind = "lookup"`). Controls share
 * renderers, client initializers, and server endpoints; only the surrounding
 * wrapper differs between mounts.
 */

export type ControlMount = 'form-field' | 'widget'

/**
 * Names controls can be registered under. Single namespace — form `type` and
 * widget `kind` both resolve against this pool at render time.
 */
export type ControlName = 'board' | 'lookup'
