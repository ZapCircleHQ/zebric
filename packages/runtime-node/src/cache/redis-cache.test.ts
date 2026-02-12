import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGet,
  mockSet,
  mockSetex,
  mockDel,
  mockIncr,
  mockExists,
  mockKeys,
  mockQuit,
  mockOn,
  redisCtor,
} = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockSet = vi.fn()
  const mockSetex = vi.fn()
  const mockDel = vi.fn()
  const mockIncr = vi.fn()
  const mockExists = vi.fn()
  const mockKeys = vi.fn()
  const mockQuit = vi.fn()
  const mockOn = vi.fn()
  const redisCtor = vi.fn()

  return { mockGet, mockSet, mockSetex, mockDel, mockIncr, mockExists, mockKeys, mockQuit, mockOn, redisCtor }
})

vi.mock('ioredis', () => {
  return {
    default: redisCtor.mockImplementation(() => ({
      get: mockGet,
      set: mockSet,
      setex: mockSetex,
      del: mockDel,
      incr: mockIncr,
      exists: mockExists,
      keys: mockKeys,
      quit: mockQuit,
      on: mockOn,
    })),
  }
})

import { RedisCache } from './redis-cache.js'

describe('RedisCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs with url and key prefix', () => {
    new RedisCache({ url: 'redis://localhost:6379', keyPrefix: 'x:' })

    expect(redisCtor).toHaveBeenCalledTimes(1)
    expect(redisCtor).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({ keyPrefix: 'x:' })
    )
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function))
  })

  it('constructs with host/port defaults and retry strategy', () => {
    new RedisCache({})
    expect(redisCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'localhost',
        port: 6379,
        db: 0,
        keyPrefix: 'zbl:',
      })
    )

    const options = redisCtor.mock.calls[0]?.[0]
    expect(options.retryStrategy(1)).toBe(50)
    expect(options.retryStrategy(100)).toBe(2000)
  })

  it('gets values and parses JSON when possible', async () => {
    const cache = new RedisCache()
    mockGet.mockResolvedValueOnce('{"a":1}')
    mockGet.mockResolvedValueOnce('raw-string')
    mockGet.mockResolvedValueOnce(null)

    expect(await cache.get<{ a: number }>('k1')).toEqual({ a: 1 })
    expect(await cache.get<string>('k2')).toBe('raw-string')
    expect(await cache.get('k3')).toBeNull()
  })

  it('sets values with and without TTL', async () => {
    const cache = new RedisCache()

    await cache.set('k1', { a: 1 }, 10)
    await cache.set('k2', 'v2')

    expect(mockSetex).toHaveBeenCalledWith('k1', 10, '{"a":1}')
    expect(mockSet).toHaveBeenCalledWith('k2', '"v2"')
  })

  it('delegates delete/incr/exists', async () => {
    const cache = new RedisCache()
    mockIncr.mockResolvedValue(5)
    mockExists.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    await cache.delete('x')
    expect(mockDel).toHaveBeenCalledWith('x')
    expect(await cache.incr('n')).toBe(5)
    expect(await cache.exists('e1')).toBe(true)
    expect(await cache.exists('e2')).toBe(false)
  })

  it('clears only when keys are present and closes client', async () => {
    const cache = new RedisCache()
    mockKeys.mockResolvedValueOnce([]).mockResolvedValueOnce(['a', 'b'])

    await cache.clear()
    expect(mockDel).not.toHaveBeenCalled()

    await cache.clear()
    expect(mockDel).toHaveBeenCalledWith('a', 'b')

    await cache.close()
    expect(mockQuit).toHaveBeenCalled()
  })

  it('exposes underlying client', () => {
    const cache = new RedisCache()
    expect(cache.getClient()).toBeDefined()
  })
})
