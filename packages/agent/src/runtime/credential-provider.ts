export type ZebricCredentialReference =
  | { type: 'env'; name: string }
  | { type: 'provider'; resolve: ZebricCredentialProvider }

export type ZebricCredentialProvider = () => string | undefined | Promise<string | undefined>

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function validateCredentialReference(reference: ZebricCredentialReference): void {
  if (reference.type === 'env') {
    if (!ENVIRONMENT_NAME.test(reference.name)) {
      throw new TypeError(`Invalid credential environment variable name: ${reference.name}`)
    }
    return
  }
  if (reference.type === 'provider' && typeof reference.resolve === 'function') return
  throw new TypeError('Invalid Zebric credential reference')
}

export function credentialProvider(
  reference: ZebricCredentialReference | ZebricCredentialProvider | undefined
): ZebricCredentialProvider | undefined {
  if (!reference) return undefined
  if (typeof reference === 'function') return reference
  validateCredentialReference(reference)
  if (reference.type === 'provider') return reference.resolve
  return () => {
    const value = process.env[reference.name]
    if (!value) throw new Error(`Zebric credential environment variable is not set: ${reference.name}`)
    return value
  }
}
