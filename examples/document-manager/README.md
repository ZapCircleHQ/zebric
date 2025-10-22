# Document Manager Example

A simple document management system demonstrating file upload functionality in Zebric.

## Features

- User authentication
- File upload with validation (PDF, Word, images, text)
- Document categorization (contract, invoice, report, other)
- File size limit (10MB)
- MIME type validation
- Document metadata (title, description, category)
- User-owned document access control
- Dashboard with recent documents

## Running the Example

1. Install dependencies:
```bash
pnpm install
```

2. Start the development server:
```bash
pnpm dev
```

3. Visit http://localhost:3000

## Uploading Documents

1. Navigate to `/documents/upload`
2. Fill in the document details:
   - **Title**: Required document title
   - **Description**: Optional description
   - **Category**: Select from contract, invoice, report, or other
   - **File**: Upload a file (PDF, Word, images, text files up to 10MB)
3. Click "Create" to upload

## File Storage

Uploaded files are stored in `./data/uploads/` with the following naming convention:
- Filename: `{ULID}{extension}` (e.g., `01HQZTABC123.pdf`)
- Accessible via: `/uploads/{filename}`

## Document Entity Fields

When a file is uploaded, the following fields are automatically populated:

- `file`: URL path to the uploaded file (e.g., `/uploads/01HQZT...abc.pdf`)
- `file_id`: Unique file identifier
- `file_filename`: Original filename
- `file_size`: File size in bytes
- `file_mimetype`: File MIME type (e.g., `application/pdf`)

## Access Control

Documents can only be read, updated, and deleted by:
- The user who uploaded them
- Admin users

This is enforced through the `[entity.Document.access]` rules in the blueprint.

## Supported File Types

- **PDF**: `application/pdf`
- **JPEG Images**: `image/jpeg`
- **PNG Images**: `image/png`
- **Word Documents**: `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- **Text Files**: `text/plain`

## Configuration

Maximum file size: 10MB (configurable in the `max` field)

To change the max file size, update the form field in `blueprint.toml`:

```toml
[[page."/documents/upload".form.fields]]
name = "file"
type = "file"
max = 20971520  # 20MB in bytes
```

## Database Schema

The Document entity stores both document metadata and file information:

```
Document:
  - id (ULID, primary key)
  - title (Text, required)
  - description (LongText, optional)
  - category (Enum: contract|invoice|report|other)
  - file (Text, required) - File URL
  - file_id (Text) - File identifier
  - file_filename (Text) - Original name
  - file_size (Integer) - Size in bytes
  - file_mimetype (Text) - MIME type
  - userId (Ref to User)
  - createdAt (DateTime)
  - updatedAt (DateTime)
```
