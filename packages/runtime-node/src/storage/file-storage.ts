import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ulid } from 'ulid'
import type { UploadedFile as BaseUploadedFile } from '@zebric/runtime-core'

export type UploadableFile = File | {
  name?: string
  filename?: string
  mimetype?: string
  type?: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface UploadedFileDetails extends BaseUploadedFile {
  filename: string
  path: string
}

export interface StorageConfig {
  type: 'local' | 's3'
  uploadDir?: string
  baseUrl?: string
  // S3 config (for future implementation)
  s3Bucket?: string
  s3Region?: string
  s3AccessKeyId?: string
  s3SecretAccessKey?: string
}

export class FileStorage {
  private config: StorageConfig

  constructor(config?: Partial<StorageConfig>) {
    this.config = {
      type: config?.type || 'local',
      uploadDir: config?.uploadDir || './data/uploads',
      baseUrl: config?.baseUrl || '/uploads',
      ...config,
    }
  }

  async initialize(): Promise<void> {
    if (this.config.type === 'local') {
      await this.ensureUploadDirectory()
    }
  }

  private async ensureUploadDirectory(): Promise<void> {
    if (!this.config.uploadDir) return

    try {
      await fs.access(this.config.uploadDir)
    } catch {
      await fs.mkdir(this.config.uploadDir, { recursive: true })
    }
  }

  async saveFile(file: UploadableFile): Promise<UploadedFileDetails> {
    if (this.config.type === 'local') {
      return this.saveFileLocally(file)
    }

    throw new Error(`Storage type ${this.config.type} not yet implemented`)
  }

  private async saveFileLocally(file: UploadableFile): Promise<UploadedFileDetails> {
    if (!this.config.uploadDir) {
      throw new Error('Upload directory not configured')
    }

    // Generate unique filename
    const fileId = ulid()
    const originalName = this.getOriginalName(file)
    const ext = path.extname(originalName)
    const filename = `${fileId}${ext}`
    const filePath = path.join(this.config.uploadDir, filename)

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(filePath, buffer)

    const uploadedFile: UploadedFileDetails = {
      id: fileId,
      filename,
      originalName,
      mimeType: this.getMimeTypeFromFile(file, filename),
      size: buffer.length,
      path: filePath,
      url: `${this.config.baseUrl}/${filename}`,
    }

    return uploadedFile
  }

  async deleteFile(fileId: string): Promise<void> {
    if (this.config.type === 'local') {
      return this.deleteFileLocally(fileId)
    }

    throw new Error(`Storage type ${this.config.type} not yet implemented`)
  }

  private async deleteFileLocally(fileId: string): Promise<void> {
    if (!this.config.uploadDir) return

    // Find file with this ID (need to handle different extensions)
    const files = await fs.readdir(this.config.uploadDir)
    const fileToDelete = files.find(f => f.startsWith(fileId))

    if (fileToDelete) {
      const filePath = path.join(this.config.uploadDir, fileToDelete)
      await fs.unlink(filePath)
    }
  }

  async getFile(fileId: string): Promise<UploadedFileDetails | null> {
    if (this.config.type === 'local') {
      return this.getFileLocally(fileId)
    }

    throw new Error(`Storage type ${this.config.type} not yet implemented`)
  }

  private async getFileLocally(fileId: string): Promise<UploadedFileDetails | null> {
    if (!this.config.uploadDir) return null

    const files = await fs.readdir(this.config.uploadDir)
    const foundFile = files.find(f => f.startsWith(fileId))

    if (!foundFile) return null

    const filePath = path.join(this.config.uploadDir, foundFile)
    const stats = await fs.stat(filePath)

    return {
      id: fileId,
      filename: foundFile,
      originalName: foundFile,
      mimeType: this.getMimeType(foundFile),
      size: stats.size,
      path: filePath,
      url: `${this.config.baseUrl}/${foundFile}`,
    }
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }

    return mimeTypes[ext] || 'application/octet-stream'
  }

  /**
   * Validate file before upload
   */
  validateFile(file: UploadableFile, options?: {
    maxSize?: number
    allowedTypes?: string[]
  }): { valid: boolean; error?: string } {
    const maxSize = options?.maxSize || 50 * 1024 * 1024 // 50MB default
    const allowedTypes = options?.allowedTypes

    // Check file size
    if (this.getFileSize(file) > maxSize) {
      return {
        valid: false,
        error: `File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`,
      }
    }

    // Check MIME type
    if (allowedTypes && allowedTypes.length > 0) {
      const mimeType = this.getMimeTypeFromFile(file)
      if (!allowedTypes.includes(mimeType)) {
        return {
          valid: false,
          error: `File type ${mimeType} is not allowed`,
        }
      }
    }

    return { valid: true }
  }

  private getOriginalName(file: UploadableFile): string {
    return file.name || (file as any).filename || 'upload'
  }

  private getMimeTypeFromFile(file: UploadableFile, fallbackName?: string): string {
    return file.type || (file as any).mimetype || this.getMimeType(fallbackName || this.getOriginalName(file))
  }

  private getFileSize(file: UploadableFile): number {
    if ('size' in file) {
      return file.size
    }
    return (file as any).file?.bytesRead || 0
  }
}
