import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('ulid', () => ({
  ulid: vi.fn(() => '01TESTULID'),
}))

import { FileStorage } from './file-storage.js'

function makeFile(data: string, options?: { name?: string; filename?: string; type?: string; mimetype?: string }) {
  const bytes = Buffer.from(data)
  return {
    name: options?.name,
    filename: options?.filename,
    type: options?.type,
    mimetype: options?.mimetype,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

describe('FileStorage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zebric-file-storage-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('initializes local storage directory', async () => {
    const nested = join(dir, 'uploads', 'nested')
    const storage = new FileStorage({ uploadDir: nested, baseUrl: '/files' })

    await storage.initialize()
    const files = await readdir(join(dir, 'uploads'))
    expect(files).toContain('nested')
  })

  it('saves, reads, and deletes files locally', async () => {
    const storage = new FileStorage({ uploadDir: dir, baseUrl: '/files' })
    const file = makeFile('hello world', { name: 'report.txt' })

    const saved = await storage.saveFile(file)
    expect(saved.id).toBe('01TESTULID')
    expect(saved.filename).toBe('01TESTULID.txt')
    expect(saved.originalName).toBe('report.txt')
    expect(saved.mimeType).toBe('text/plain')
    expect(saved.url).toBe('/files/01TESTULID.txt')

    const loaded = await storage.getFile('01TESTULID')
    expect(loaded).toBeDefined()
    expect(loaded?.filename).toBe('01TESTULID.txt')
    expect(loaded?.mimeType).toBe('text/plain')
    expect(loaded?.size).toBe(11)

    await storage.deleteFile('01TESTULID')
    expect(await storage.getFile('01TESTULID')).toBeNull()
  })

  it('supports filename/mimetype fields when name/type are absent', async () => {
    const storage = new FileStorage({ uploadDir: dir, baseUrl: '/files' })
    const file = makeFile('a,b', { filename: 'data.csv', mimetype: 'text/csv' })

    const saved = await storage.saveFile(file as any)
    expect(saved.originalName).toBe('data.csv')
    expect(saved.mimeType).toBe('text/csv')
  })

  it('falls back to octet-stream and upload name defaults', async () => {
    const storage = new FileStorage({ uploadDir: dir, baseUrl: '/files' })
    const bytes = Buffer.from([1, 2, 3])
    const file = {
      size: bytes.length,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      },
    }

    const saved = await storage.saveFile(file as any)
    expect(saved.originalName).toBe('upload')
    expect(saved.mimeType).toBe('application/octet-stream')
  })

  it('returns null for missing files and no-op delete for unknown IDs', async () => {
    const storage = new FileStorage({ uploadDir: dir })
    expect(await storage.getFile('missing')).toBeNull()
    await expect(storage.deleteFile('missing')).resolves.toBeUndefined()
  })

  it('validates file size and allowed types', () => {
    const storage = new FileStorage({ uploadDir: dir })
    const txt = makeFile('ok', { name: 'note.txt', type: 'text/plain' })

    expect(storage.validateFile(txt, { maxSize: 1 })).toEqual({
      valid: false,
      error: 'File size exceeds maximum allowed size of 9.5367431640625e-7MB',
    })
    expect(storage.validateFile(txt, { allowedTypes: ['image/png'] })).toEqual({
      valid: false,
      error: 'File type text/plain is not allowed',
    })
    expect(storage.validateFile(txt, { maxSize: 1000, allowedTypes: ['text/plain'] })).toEqual({ valid: true })
  })

  it('uses legacy file.bytesRead when size is missing', () => {
    const storage = new FileStorage({ uploadDir: dir })
    const file = { file: { bytesRead: 2 }, type: 'text/plain' }
    expect(storage.validateFile(file as any, { maxSize: 1 }).valid).toBe(false)
  })

  it('throws for unsupported storage types', async () => {
    const storage = new FileStorage({ type: 's3', uploadDir: dir })
    const file = makeFile('hello', { name: 'a.txt' })

    await expect(storage.saveFile(file)).rejects.toThrow('Storage type s3 not yet implemented')
    await expect(storage.getFile('id')).rejects.toThrow('Storage type s3 not yet implemented')
    await expect(storage.deleteFile('id')).rejects.toThrow('Storage type s3 not yet implemented')
  })

  it('throws when uploadDir is not configured for local save', async () => {
    const storage = new FileStorage({ uploadDir: undefined as any })
    const file = makeFile('x', { name: 'x.txt' })
    await expect(storage.saveFile(file)).rejects.toThrow('Upload directory not configured')
  })
})
