import FormData from 'form-data'

const testContent = 'This is a test document.'
const testFile = Buffer.from(testContent)

const formData = new FormData()
formData.append('title', 'Test Document')
formData.append('file', testFile, {
  filename: 'test.txt',
  contentType: 'text/plain',
})

const response = await fetch('http://localhost:62253/documents/upload', {
  method: 'POST',
  body: formData,
  headers: formData.getHeaders(),
})

console.log('Status:', response.status)
const data = await response.json()
console.log('Response:', JSON.stringify(data, null, 2))
