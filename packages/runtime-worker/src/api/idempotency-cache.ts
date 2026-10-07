interface Entry {
  fingerprint: string
  response: Promise<Response>
  expiresAt: number
}

/** Per-isolate replay cache matching Node's successful-response semantics. */
export class WorkersIdempotencyCache {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly maxEntries = 1000,
  ) {}

  async run(
    scope: string,
    fingerprint: string,
    execute: () => Promise<Response>,
  ): Promise<{ conflict: true } | { conflict: false; response: Response }> {
    this.evict()
    const existing = this.entries.get(scope)
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { conflict: true }
      return { conflict: false, response: (await existing.response).clone() }
    }

    const entry: Entry = {
      fingerprint,
      response: execute(),
      expiresAt: Date.now() + this.ttlMs,
    }
    this.entries.set(scope, entry)
    this.evict()
    try {
      const response = await entry.response
      if (!response.ok && this.entries.get(scope) === entry) this.entries.delete(scope)
      return { conflict: false, response: response.clone() }
    } catch (error) {
      if (this.entries.get(scope) === entry) this.entries.delete(scope)
      throw error
    }
  }

  private evict(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

export async function requestFingerprint(...parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join('\n'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
