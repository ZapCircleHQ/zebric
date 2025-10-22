import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileStorage } from '../../../src/storage/file-storage.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { MultipartFile } from '@fastify/multipart'

describe('FileStorage', () => {
  let storage: FileStorage
  const testUploadDir = './test-uploads'

  beforeEach(async () => {
    storage = new FileStorage({
      uploadDir: testUploadDir,
      baseUrl: '/test-uploads',
    })
    await storage.initialize()
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      const files = await fs.readdir(testUploadDir)
      for (const file of files) {
        await fs.unlink(path.join(testUploadDir, file))
      }
      await fs.rmdir(testUploadDir)
    } catch (error) {
      // Directory might not exist
    }
  })

  describe('initialize', () => {
    it('should create upload directory if it does not exist', async () => {
      const newStorage = new FileStorage({
        uploadDir: './new-test-uploads',
      })
      await newStorage.initialize()

      const exists = await fs
        .access('./new-test-uploads')
        .then(() => true)
        .catch(() => false)

      expect(exists).toBe(true)

      // Cleanup
      await fs.rmdir('./new-test-uploads')
    })

    it('should not fail if directory already exists', async () => {
      await expect(storage.initialize()).resolves.not.toThrow()
    })
  })

  describe('saveFile', () => {
    it('should save file and return metadata', async () => {
      const mockFile = createMockFile('test.txt', 'text/plain', 'Hello World')
      const uploadedFile = await storage.saveFile(mockFile)

      expect(uploadedFile.id).toBeDefined()
      expect(uploadedFile.filename).toMatch(/\.txt$/)
      expect(uploadedFile.originalName).toBe('test.txt')
      expect(uploadedFile.mimeType).toBe('text/plain')
      expect(uploadedFile.size).toBe(11)
      expect(uploadedFile.url).toContain('/test-uploads/')
      expect(uploadedFile.path).toContain('test-uploads')

      // Verify file exists
      const fileExists = await fs
        .access(uploadedFile.path)
        .then(() => true)
        .catch(() => false)
      expect(fileExists).toBe(true)

      // Verify content
      const content = await fs.readFile(uploadedFile.path, 'utf-8')
      expect(content).toBe('Hello World')
    })

    it('should generate unique filenames for multiple uploads', async () => {
      const mockFile1 = createMockFile('test.txt', 'text/plain', 'File 1')
      const mockFile2 = createMockFile('test.txt', 'text/plain', 'File 2')

      const uploaded1 = await storage.saveFile(mockFile1)
      const uploaded2 = await storage.saveFile(mockFile2)

      expect(uploaded1.filename).not.toBe(uploaded2.filename)
      expect(uploaded1.id).not.toBe(uploaded2.id)
    })

    it('should preserve file extension', async () => {
      const pdfFile = createMockFile('document.pdf', 'application/pdf', 'PDF')
      const uploaded = await storage.saveFile(pdfFile)

      expect(uploaded.filename).toMatch(/\.pdf$/)
    })
  })

  describe('deleteFile', () => {
    it('should delete existing file', async () => {
      const mockFile = createMockFile('test.txt', 'text/plain', 'Delete me')
      const uploaded = await storage.saveFile(mockFile)

      await storage.deleteFile(uploaded.id)

      const fileExists = await fs
        .access(uploaded.path)
        .then(() => true)
        .catch(() => false)
      expect(fileExists).toBe(false)
    })

    it('should not throw error when deleting non-existent file', async () => {
      await expect(storage.deleteFile('non-existent-id')).resolves.not.toThrow()
    })
  })

  describe('getFile', () => {
    it('should retrieve existing file metadata', async () => {
      const mockFile = createMockFile('test.txt', 'text/plain', 'Get me')
      const uploaded = await storage.saveFile(mockFile)

      const retrieved = await storage.getFile(uploaded.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(uploaded.id)
      expect(retrieved?.filename).toBe(uploaded.filename)
      expect(retrieved?.size).toBeGreaterThan(0)
    })

    it('should return null for non-existent file', async () => {
      const result = await storage.getFile('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('validateFile', () => {
    it('should validate file size', () => {
      const smallFile = createMockFile('small.txt', 'text/plain', 'Hi', 2)
      const largeFile = createMockFile('large.txt', 'text/plain', 'Large', 1000)

      const validResult = storage.validateFile(smallFile, { maxSize: 100 })
      expect(validResult.valid).toBe(true)

      const invalidResult = storage.validateFile(largeFile, { maxSize: 100 })
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.error).toContain('size')
    })

    it('should validate MIME type', () => {
      const pdfFile = createMockFile('doc.pdf', 'application/pdf', 'PDF')
      const jpgFile = createMockFile('img.jpg', 'image/jpeg', 'JPG')

      const validResult = storage.validateFile(pdfFile, {
        allowedTypes: ['application/pdf'],
      })
      expect(validResult.valid).toBe(true)

      const invalidResult = storage.validateFile(jpgFile, {
        allowedTypes: ['application/pdf'],
      })
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.error).toContain('type')
    })

    it('should pass validation when no restrictions', () => {
      const file = createMockFile('any.txt', 'text/plain', 'Any')
      const result = storage.validateFile(file)

      expect(result.valid).toBe(true)
    })

    it('should validate both size and MIME type', () => {
      const file = createMockFile('doc.pdf', 'application/pdf', 'PDF', 50)

      const validResult = storage.validateFile(file, {
        maxSize: 100,
        allowedTypes: ['application/pdf'],
      })
      expect(validResult.valid).toBe(true)

      const invalidSizeResult = storage.validateFile(file, {
        maxSize: 10,
        allowedTypes: ['application/pdf'],
      })
      expect(invalidSizeResult.valid).toBe(false)

      const invalidTypeResult = storage.validateFile(file, {
        maxSize: 100,
        allowedTypes: ['image/jpeg'],
      })
      expect(invalidTypeResult.valid).toBe(false)
    })
  })

  describe('getMimeType', () => {
    it('should return correct MIME types for common extensions', () => {
      const storage = new FileStorage()

      // Access private method through any cast for testing
      const getMimeType = (storage as any).getMimeType.bind(storage)

      expect(getMimeType('file.pdf')).toBe('application/pdf')
      expect(getMimeType('file.jpg')).toBe('image/jpeg')
      expect(getMimeType('file.jpeg')).toBe('image/jpeg')
      expect(getMimeType('file.png')).toBe('image/png')
      expect(getMimeType('file.txt')).toBe('text/plain')
      expect(getMimeType('file.csv')).toBe('text/csv')
      expect(getMimeType('file.docx')).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    })

    it('should return default MIME type for unknown extensions', () => {
      const storage = new FileStorage()
      const getMimeType = (storage as any).getMimeType.bind(storage)

      expect(getMimeType('file.xyz')).toBe('application/octet-stream')
    })
  })
})

// Helper function to create mock MultipartFile
function createMockFile(
  filename: string,
  mimetype: string,
  content: string,
  bytesRead?: number
): MultipartFile {
  const buffer = Buffer.from(content)

  return {
    filename,
    mimetype,
    encoding: '7bit',
    fieldname: 'file',
    file: {
      bytesRead: bytesRead ?? buffer.length,
    } as any,
    fields: {},
    toBuffer: async () => buffer,
  } as MultipartFile
}
