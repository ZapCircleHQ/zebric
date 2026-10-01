import { describe, expect, it, vi } from 'vitest'
import { IdempotencyCache } from './idempotency-cache.js'

const ok = (body = 'ok') => async () => new Response(body, { status: 200 })

describe('IdempotencyCache', () => {
  it('replays a successful response without re-executing', async () => {
    const cache = new IdempotencyCache()
    const execute = vi.fn(ok('first'))
    const a = await cache.run('s:k', 'fp', execute)
    const b = await cache.run('s:k', 'fp', execute)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(a.conflict === false && await a.response.text()).toBe('first')
    expect(b.conflict === false && await b.response.text()).toBe('first')
  })

  it('reports a conflict when the key is reused with a different fingerprint', async () => {
    const cache = new IdempotencyCache()
    await cache.run('s:k', 'fp1', ok())
    const execute = vi.fn(ok())
    expect(await cache.run('s:k', 'fp2', execute)).toEqual({ conflict: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it('shares one execution between concurrent requests', async () => {
    const cache = new IdempotencyCache()
    const execute = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return new Response('done')
    })
    await Promise.all([cache.run('s:k', 'fp', execute), cache.run('s:k', 'fp', execute)])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not cache a rejection, so a retry executes again', async () => {
    const cache = new IdempotencyCache()
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Response('recovered'))
    await expect(cache.run('s:k', 'fp', execute)).rejects.toThrow('boom')
    expect(cache.size).toBe(0)
    const retry = await cache.run('s:k', 'fp', execute)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(retry.conflict === false && await retry.response.text()).toBe('recovered')
  })

  it('does not cache non-2xx responses', async () => {
    const cache = new IdempotencyCache()
    const execute = vi.fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 409 }))
      .mockResolvedValueOnce(new Response('fine', { status: 200 }))
    const first = await cache.run('s:k', 'fp', execute)
    expect(first.conflict === false && first.response.status).toBe(409)
    expect(cache.size).toBe(0)
    const second = await cache.run('s:k', 'fp', execute)
    expect(second.conflict === false && second.response.status).toBe(200)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('does not evict a newer entry when an older failed execution settles late', async () => {
    const cache = new IdempotencyCache({ maxEntries: 1 })
    let rejectFirst!: (e: Error) => void
    const first = cache.run('a', 'fp', () => new Promise<Response>((_, reject) => { rejectFirst = reject }))
    const firstOutcome = first.catch(() => undefined)
    await cache.run('b', 'fp', ok()) // evicts 'a'
    rejectFirst(new Error('late'))
    await firstOutcome
    expect(cache.size).toBe(1)
    const execute = vi.fn(ok())
    await cache.run('b', 'fp', execute)
    expect(execute).not.toHaveBeenCalled()
  })

  it('expires entries after the TTL', async () => {
    let now = 1_000
    const cache = new IdempotencyCache({ ttlMs: 100, now: () => now })
    await cache.run('s:k', 'fp', ok())
    now += 99
    const cached = vi.fn(ok())
    await cache.run('s:k', 'fp', cached)
    expect(cached).not.toHaveBeenCalled()

    now += 2
    const expired = vi.fn(ok())
    await cache.run('s:k', 'fp', expired)
    expect(expired).toHaveBeenCalledTimes(1)
  })

  it('caps the number of entries, evicting the oldest first', async () => {
    const cache = new IdempotencyCache({ maxEntries: 3 })
    for (let i = 0; i < 10; i++) await cache.run(`s:${i}`, 'fp', ok())
    expect(cache.size).toBe(3)
    const oldest = vi.fn(ok())
    await cache.run('s:0', 'fp', oldest)
    expect(oldest).toHaveBeenCalledTimes(1)
  })
})
