import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { EngineTestHarness } from '../helpers/engine-harness.js'
import FormData from 'form-data'
import { Blob } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

describe('File Upload Integration', () => {
  const harness = new EngineTestHarness()
  let baseUrl: string

  const blueprint = `
version = "0.1.0"

[project]
name = "File Upload Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", unique = true, required = true },
  { name = "name", type = "Text", required = true },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.Document]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "file", type = "Text", required = true },
  { name = "file_id", type = "Text" },
  { name = "file_filename", type = "Text" },
  { name = "file_size", type = "Integer" },
  { name = "file_mimetype", type = "Text" },
  { name = "userId", type = "Ref", ref = "User.id", required = true },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.Document.access]
create = true
read = true

[page."/documents/upload"]
title = "Upload Document"
auth = "optional"
layout = "form"

[page."/documents/upload".form]
entity = "Document"
method = "create"

[[page."/documents/upload".form.fields]]
name = "title"
type = "text"
required = true

[[page."/documents/upload".form.fields]]
name = "file"
type = "file"
required = true
accept = ["application/pdf", "text/plain", "image/jpeg"]
max = 1048576

[page."/documents/upload".form.onSuccess]
redirect = "/documents/{id}"

[page."/documents/:id"]
title = "Document"
auth = "optional"
layout = "detail"

[page."/documents/:id".query.document]
entity = "Document"
where = { id = "$params.id" }

[auth]
providers = ["email"]
trustedOrigins = ["http://localhost:3000"]

[ui]
render_mode = "server"
`

  beforeAll(async () => {
    baseUrl = await harness.setup(blueprint)
  })

  afterAll(async () => {
    await harness.teardown()
  })

  describe('File upload via multipart form', () => {
    it('should upload a text file successfully', async () => {
      // Create a test file
      const testContent = 'This is a test document.'
      const testFile = Buffer.from(testContent)

      // Create form data
      const formData = new FormData()
      formData.append('title', 'Test Document')
      formData.append('file', testFile, {
        filename: 'test.txt',
        contentType: 'text/plain',
      })

      // Upload file
      const response = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      expect(response.status).toBe(200)

      // Get the response
      const data = await response.json()
      expect(data.id).toBeDefined()
      expect(data.title).toBe('Test Document')
      expect(data.file).toContain('/uploads/')
      expect(data.file_id).toBeDefined()
      expect(data.file_filename).toBe('test.txt')
      expect(data.file_size).toBe(testContent.length)
      expect(data.file_mimetype).toBe('text/plain')
    })

    it('should upload a PDF file', async () => {
      // Create a minimal PDF
      const pdfContent = Buffer.from('%PDF-1.4\n%EOF')

      const formData = new FormData()
      formData.append('title', 'PDF Document')
      formData.append('file', pdfContent, {
        filename: 'document.pdf',
        contentType: 'application/pdf',
      })

      const response = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.file_filename).toBe('document.pdf')
      expect(data.file_mimetype).toBe('application/pdf')
      expect(data.file).toMatch(/\.pdf$/)
    })

    it('should reject file larger than max size', async () => {
      // Create a file larger than 1MB
      const largeContent = Buffer.alloc(2 * 1024 * 1024, 'x')

      const formData = new FormData()
      formData.append('title', 'Large File')
      formData.append('file', largeContent, {
        filename: 'large.txt',
        contentType: 'text/plain',
      })

      const response = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBeDefined()
    })

    it('should reject disallowed file type', async () => {
      const content = Buffer.from('Some content')

      const formData = new FormData()
      formData.append('title', 'Wrong Type')
      formData.append('file', content, {
        filename: 'file.exe',
        contentType: 'application/x-msdownload',
      })

      const response = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBeDefined()
    })

    it('should require file when marked as required', async () => {
      const formData = new FormData()
      formData.append('title', 'No File')
      // Not appending file

      const response = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Validation failed')
      expect(data.errors).toBeDefined()
    })

    it('should serve uploaded file', async () => {
      // Upload a file first
      const testContent = 'Downloadable content'
      const testFile = Buffer.from(testContent)

      const formData = new FormData()
      formData.append('title', 'Download Test')
      formData.append('file', testFile, {
        filename: 'download.txt',
        contentType: 'text/plain',
      })

      const uploadResponse = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      const uploadData = await uploadResponse.json()
      const fileUrl = uploadData.file

      // Download the file
      const downloadResponse = await fetch(`${baseUrl}${fileUrl}`)
      expect(downloadResponse.status).toBe(200)

      const downloadedContent = await downloadResponse.text()
      expect(downloadedContent).toBe(testContent)
    })

    it('should handle multiple file uploads to same entity', async () => {
      // Upload first file
      const formData1 = new FormData()
      formData1.append('title', 'First Document')
      formData1.append('file', Buffer.from('First'), {
        filename: 'first.txt',
        contentType: 'text/plain',
      })

      const response1 = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData1 as any,
        headers: formData1.getHeaders(),
      })

      const data1 = await response1.json()

      // Upload second file
      const formData2 = new FormData()
      formData2.append('title', 'Second Document')
      formData2.append('file', Buffer.from('Second'), {
        filename: 'second.txt',
        contentType: 'text/plain',
      })

      const response2 = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData2 as any,
        headers: formData2.getHeaders(),
      })

      const data2 = await response2.json()

      // Verify they have different file IDs and URLs
      expect(data1.file_id).not.toBe(data2.file_id)
      expect(data1.file).not.toBe(data2.file)
    })

    it('should preserve file extension', async () => {
      const extensions = [
        { ext: 'pdf', mime: 'application/pdf' },
        { ext: 'txt', mime: 'text/plain' },
        { ext: 'jpg', mime: 'image/jpeg' },
      ]

      for (const { ext, mime } of extensions) {
        const formData = new FormData()
        formData.append('title', `Test ${ext}`)
        formData.append('file', Buffer.from('content'), {
          filename: `file.${ext}`,
          contentType: mime,
        })

        const response = await fetch(`${baseUrl}/documents/upload`, {
          method: 'POST',
          body: formData as any,
          headers: formData.getHeaders(),
        })

        const data = await response.json()
        expect(data.file).toMatch(new RegExp(`\\.${ext}$`))
      }
    })
  })

  describe('Mixed form data', () => {
    it('should handle both file and text fields', async () => {
      const formData = new FormData()
      formData.append('title', 'Mixed Form Data')
      formData.append('file', Buffer.from('File content'), {
        filename: 'mixed.txt',
        contentType: 'text/plain',
      })

      const response = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.title).toBe('Mixed Form Data')
      expect(data.file).toBeDefined()
      expect(data.file_filename).toBe('mixed.txt')
    })
  })
})
