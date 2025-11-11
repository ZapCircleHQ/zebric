import { describe, it, expect, beforeEach } from 'vitest'
import { R2Storage } from './r2-storage.js'
import { MockR2Bucket } from '../test-helpers/mocks.js'

describe('R2Storage', () => {
  let bucket: MockR2Bucket
  let storage: R2Storage

  beforeEach(() => {
    bucket = new MockR2Bucket()
    storage = new R2Storage({
      bucket: bucket as any,
      publicUrlBase: 'https://cdn.example.com'
    })
  })

  describe('store', () => {
    it('should store ArrayBuffer data', async () => {
      const data = new TextEncoder().encode('Hello World').buffer
      const url = await storage.store('test.txt', data)

      expect(url).toBe('https://cdn.example.com/test.txt')

      const obj = await bucket.get('test.txt')
      expect(obj).not.toBeNull()
      expect(obj!.size).toBe(11)
    })

    it('should store ReadableStream data', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('Stream data'))
          controller.close()
        }
      })

      const url = await storage.store('stream.txt', stream)
      expect(url).toBe('https://cdn.example.com/stream.txt')
    })

    it('should store with content type', async () => {
      const data = new TextEncoder().encode('{"foo":"bar"}').buffer

      await storage.store('data.json', data, 'application/json')

      const obj = await bucket.head('data.json')
      expect(obj!.httpMetadata?.contentType).toBe('application/json')
    })

    it('should return key when no public URL base', async () => {
      const storageNoUrl = new R2Storage({ bucket: bucket as any })
      const data = new TextEncoder().encode('test').buffer

      const url = await storageNoUrl.store('test.txt', data)
      expect(url).toBe('test.txt')
    })
  })

  describe('retrieve', () => {
    it('should retrieve stored data', async () => {
      const original = new TextEncoder().encode('Test data')
      await storage.store('test.txt', original.buffer)

      const retrieved = await storage.retrieve('test.txt')
      expect(retrieved).not.toBeNull()

      // Read the stream
      const reader = retrieved!.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      // Combine chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      const text = new TextDecoder().decode(combined)
      expect(text).toBe('Test data')
    })

    it('should return null for non-existent key', async () => {
      const data = await storage.retrieve('nonexistent.txt')
      expect(data).toBeNull()
    })
  })

  describe('delete', () => {
    it('should delete stored object', async () => {
      const data = new TextEncoder().encode('test').buffer
      await storage.store('test.txt', data)

      await storage.delete('test.txt')

      const obj = await bucket.get('test.txt')
      expect(obj).toBeNull()
    })
  })

  describe('exists', () => {
    it('should return true for existing object', async () => {
      const data = new TextEncoder().encode('test').buffer
      await storage.store('test.txt', data)

      const exists = await storage.exists('test.txt')
      expect(exists).toBe(true)
    })

    it('should return false for non-existent object', async () => {
      const exists = await storage.exists('nonexistent.txt')
      expect(exists).toBe(false)
    })
  })

  describe('list', () => {
    it('should list objects with prefix', async () => {
      await storage.store('files/a.txt', new ArrayBuffer(0))
      await storage.store('files/b.txt', new ArrayBuffer(0))
      await storage.store('other/c.txt', new ArrayBuffer(0))

      const list = await storage.list('files/')
      expect(list).toHaveLength(2)
      expect(list.map(o => o.key)).toContain('files/a.txt')
      expect(list.map(o => o.key)).toContain('files/b.txt')
    })

    it('should list all objects when no prefix', async () => {
      await storage.store('a.txt', new ArrayBuffer(0))
      await storage.store('b.txt', new ArrayBuffer(0))

      const list = await storage.list()
      expect(list.length).toBeGreaterThanOrEqual(2)
    })

    it('should return object metadata', async () => {
      const data = new TextEncoder().encode('test').buffer
      await storage.store('test.txt', data, 'text/plain')

      const list = await storage.list('test')
      expect(list[0].key).toBe('test.txt')
      expect(list[0].size).toBe(4)
      expect(list[0].uploaded).toBeInstanceOf(Date)
    })
  })

  describe('getMetadata', () => {
    it('should get object metadata', async () => {
      const data = new TextEncoder().encode('Hello').buffer
      await storage.store('test.txt', data, 'text/plain')

      const metadata = await storage.getMetadata('test.txt')
      expect(metadata).not.toBeNull()
      expect(metadata!.size).toBe(5)
      expect(metadata!.contentType).toBe('text/plain')
    })

    it('should return null for non-existent object', async () => {
      const metadata = await storage.getMetadata('nonexistent.txt')
      expect(metadata).toBeNull()
    })
  })
})
