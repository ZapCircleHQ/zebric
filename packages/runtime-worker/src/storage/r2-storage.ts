/**
 * R2 Storage Adapter
 *
 * Implements file storage using CloudFlare R2.
 */

export interface R2StorageConfig {
  bucket: R2Bucket
  publicUrlBase?: string // For generating public URLs
}

export class R2Storage {
  constructor(private config: R2StorageConfig) {}

  async store(key: string, data: ArrayBuffer | ReadableStream, contentType?: string): Promise<string> {
    try {
      const options: R2PutOptions = {}
      if (contentType) {
        options.httpMetadata = { contentType }
      }

      await this.config.bucket.put(key, data, options)

      // Return public URL if configured
      if (this.config.publicUrlBase) {
        return `${this.config.publicUrlBase}/${key}`
      }

      return key
    } catch (error) {
      throw new Error(`Failed to store file ${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async retrieve(key: string): Promise<ReadableStream | null> {
    try {
      const object = await this.config.bucket.get(key)
      return object?.body || null
    } catch (error) {
      console.error(`Failed to retrieve file ${key}:`, error)
      return null
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.config.bucket.delete(key)
    } catch (error) {
      console.error(`Failed to delete file ${key}:`, error)
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const object = await this.config.bucket.head(key)
      return object !== null
    } catch {
      return false
    }
  }

  async list(prefix?: string): Promise<Array<{ key: string; size: number; uploaded: Date }>> {
    try {
      const options: R2ListOptions = {}
      if (prefix) {
        options.prefix = prefix
      }

      const listed = await this.config.bucket.list(options)
      return listed.objects.map(obj => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded
      }))
    } catch (error) {
      console.error(`Failed to list files with prefix ${prefix}:`, error)
      return []
    }
  }

  async getMetadata(key: string): Promise<{ size: number; contentType?: string; uploaded: Date } | null> {
    try {
      const obj = await this.config.bucket.head(key)
      if (!obj) return null

      return {
        size: obj.size,
        contentType: obj.httpMetadata?.contentType,
        uploaded: obj.uploaded
      }
    } catch (error) {
      console.error(`Failed to get metadata for ${key}:`, error)
      return null
    }
  }
}
