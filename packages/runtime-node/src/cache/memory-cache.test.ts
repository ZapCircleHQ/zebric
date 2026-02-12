import { describe, it, expect, vi } from 'vitest'
import { MemoryCache } from './memory-cache.js'

describe('MemoryCache', () => {
  it('stores and retrieves values', async () => {
    const cache = new MemoryCache()

    await cache.set('a', { ok: true })
    expect(await cache.get<{ ok: boolean }>('a')).toEqual({ ok: true })
    expect(await cache.exists('a')).toBe(true)
  })

  it('expires values by TTL for get and exists', async () => {
    const cache = new MemoryCache()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    await cache.set('ttl', 'x', 1)

    now.mockReturnValue(1500)
    expect(await cache.get('ttl')).toBe('x')
    expect(await cache.exists('ttl')).toBe(true)

    now.mockReturnValue(2501)
    expect(await cache.get('ttl')).toBeNull()
    expect(await cache.exists('ttl')).toBe(false)
    now.mockRestore()
  })

  it('deletes keys', async () => {
    const cache = new MemoryCache()
    await cache.set('k', 1)
    await cache.delete('k')
    expect(await cache.get('k')).toBeNull()
  })

  it('increments values and resets expired values', async () => {
    const cache = new MemoryCache()
    const now = vi.spyOn(Date, 'now')

    now.mockReturnValue(1000)
    await cache.set('counter', 5, 1)
    expect(await cache.incr('counter')).toBe(6)
    expect(await cache.incr('missing')).toBe(1)

    now.mockReturnValue(2500)
    expect(await cache.incr('counter')).toBe(1)
    now.mockRestore()
  })

  it('clears and closes cache', async () => {
    const cache = new MemoryCache()
    await cache.set('a', 1)
    await cache.set('b', 2)
    await cache.clear()
    expect(await cache.exists('a')).toBe(false)
    expect(await cache.exists('b')).toBe(false)

    await cache.set('c', 3)
    await cache.close()
    expect(await cache.exists('c')).toBe(false)
  })
})
