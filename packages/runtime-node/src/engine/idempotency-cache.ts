export interface IdempotencyCacheOptions {
  /** How long a successful response is replayed for. */
  ttlMs?: number
  /** Maximum number of retained entries; the oldest are evicted first. */
  maxEntries?: number
  now?: () => number
}

export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
export const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 1000

interface Entry {
  fingerprint: string
  response: Promise<Response>
  expiresAt: number
}

export type IdempotencyResult =
  | { conflict: true }
  | { conflict: false; response: Response }

/**
 * Replays the response for a repeated Idempotency-Key. Only successful (2xx)
 * responses are retained: failures are dropped so the caller can retry, and
 * entries expire and are capped so the cache cannot grow without bound.
 */
export class IdempotencyCache {
  private readonly entries = new Map<string, Entry>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: IdempotencyCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_IDEMPOTENCY_MAX_ENTRIES
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.entries.size
  }

  async run(scope: string, fingerprint: string, execute: () => Promise<Response>): Promise<IdempotencyResult> {
    this.evictExpired()
    const existing = this.entries.get(scope)
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { conflict: true }
      return { conflict: false, response: (await existing.response).clone() }
    }

    const entry: Entry = {
      fingerprint,
      response: execute(),
      expiresAt: this.now() + this.ttlMs,
    }
    this.entries.set(scope, entry)
    this.evictOverflow()
    try {
      const response = await entry.response
      if (!response.ok) this.drop(scope, entry)
      return { conflict: false, response: response.clone() }
    } catch (error) {
      this.drop(scope, entry)
      throw error
    }
  }

  private drop(scope: string, entry: Entry): void {
    if (this.entries.get(scope) === entry) this.entries.delete(scope)
  }

  private evictExpired(): void {
    const now = this.now()
    // Map iterates in insertion order, which is also expiry order.
    for (const [scope, entry] of this.entries) {
      if (entry.expiresAt > now) break
      this.entries.delete(scope)
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}
