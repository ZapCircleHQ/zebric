# Zebric Runtime Test Suite

Comprehensive test coverage for the Zebric Runtime Engine.

## Test Structure

```
tests/
├── unit/               # Unit tests for individual components
│   ├── security/       # XSS detection, input validation, HTML escaping
│   ├── database/       # Schema generation, query building
│   ├── renderer/       # Theme system, HTML rendering
│   ├── server/         # Route handling, HTTP server
│   ├── workflows/      # Workflow execution
│   └── auth/           # Authentication and permissions
│
└── integration/        # Integration tests for full workflows
    ├── crud-operations.spec.ts    # CREATE, READ, UPDATE, DELETE
    ├── auth-flows.spec.ts         # Sign-up, sign-in, sessions
    └── error-handling.spec.ts     # Error responses and edge cases
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests in UI mode
pnpm test:ui

# Run specific test file
pnpm test tests/unit/security/html-escape.spec.ts

# Run tests matching pattern
pnpm test --grep "CRUD"

# Run tests in watch mode
pnpm test --watch
```

## Coverage Targets

- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 80%
- **Statements**: 80%

Coverage reports are generated in:
- `coverage/html/index.html` - HTML report
- `coverage/lcov.info` - LCOV format
- `coverage/coverage-final.json` - JSON format

## Test Categories

### Unit Tests

#### Security (`tests/unit/security/`)
- **html-escape.spec.ts**: Tests for XSS detection and HTML escaping
  - Script tag detection
  - Event handler detection
  - Protocol validation (javascript:, data:)
  - Template tag auto-escaping
  - Safe HTML marking

- **input-validator.spec.ts**: Input validation and sanitization
  - Required field validation
  - Type validation (string, number, boolean, email, URL, UUID)
  - String constraints (minLength, maxLength, pattern)
  - Number constraints (min, max)
  - Enum validation
  - XSS detection in inputs
  - Custom validators
  - Body size limits

#### Database (`tests/unit/database/`)
- **schema-generator.spec.ts**: Database schema generation
  - Field type mapping (Text, Integer, Float, Boolean, DateTime, JSON, ULID)
  - Nullable fields
  - Relationships (Ref fields)
  - Enum fields
  - Default values
  - Unique constraints
  - Indexes
  - Table name normalization

#### Renderer (`tests/unit/renderer/`)
- **theme.spec.ts**: Theme system
  - Default theme properties
  - Dark theme overrides
  - Custom theme creation
  - Custom CSS support
  - Theme consistency checks

### Integration Tests

#### CRUD Operations (`tests/integration/crud-operations.spec.ts`)
- **CREATE**: New record creation, validation, XSS rejection
- **READ**: List all, get by ID, 404 handling
- **UPDATE**: Record updates, validation, 404 handling
- **DELETE**: Record deletion, verification, 404 handling
- **Validation**: Required fields, type enforcement, default values

#### Authentication Flows (`tests/integration/auth-flows.spec.ts`)
- **Sign Up**: Account creation, duplicate email detection, password strength, email validation, XSS sanitization
- **Sign In**: Valid credentials, invalid password, non-existent users, timing attack prevention
- **Sessions**: Session retrieval, session validation, sign-out, session clearing
- **Protected Routes**: Authentication enforcement, owner-only permissions, access control
- **Password Reset**: Reset requests, email enumeration prevention
- **Security Headers**: Cookie flags (HttpOnly, Secure), security headers

#### Error Handling (`tests/integration/error-handling.spec.ts`)
- **Validation Errors (400)**: Missing fields, invalid types, malformed JSON, sanitized messages
- **Not Found (404)**: Non-existent entities, non-existent records, invalid IDs
- **Method Not Allowed (405)**: Unsupported HTTP methods, Allow header
- **Rate Limiting (429)**: Rate limit enforcement, Retry-After header
- **Payload Too Large (413)**: Request body size limits
- **Unsupported Media Type (415)**: Content-Type validation
- **Database Errors**: Unique constraint violations
- **Server Errors (500)**: Internal error handling, information sanitization
- **CORS**: Origin validation, preflight requests
- **Error Format**: Consistent error structure, request IDs
- **Concurrency**: Multiple concurrent requests, response integrity

## Writing Tests

### Unit Test Template

```typescript
import { describe, it, expect } from 'vitest'
import { YourModule } from '../../../src/path/to/module.js'

describe('YourModule', () => {
  describe('yourMethod', () => {
    it('should do something', () => {
      const result = YourModule.yourMethod('input')
      expect(result).toBe('expected')
    })
  })
})
```

### Integration Test Template

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ZebricEngine } from '../../src/engine.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Feature Name', () => {
  let engine: ZebricEngine
  let tempDir: string
  let baseUrl: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'test-'))
    const blueprintPath = join(tempDir, 'blueprint.json')
    writeFileSync(blueprintPath, JSON.stringify(blueprint, null, 2))

    const port = 60000 + Math.floor(Math.random() * 5000)
    baseUrl = `http://127.0.0.1:${port}`

    engine = new ZebricEngine({
      blueprintPath,
      port,
      host: '127.0.0.1',
      dev: { hotReload: false, logLevel: 'error', dbPath: join(tempDir, 'test.db') }
    })

    await engine.start()
  })

  afterEach(async () => {
    await engine.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should do something', async () => {
    const response = await fetch(`${baseUrl}/api/endpoint`)
    expect(response.status).toBe(200)
  })
})
```

## Best Practices

1. **Test Isolation**: Each test should be independent and not rely on others
2. **Cleanup**: Always clean up resources (temporary files, database connections)
3. **Descriptive Names**: Use clear, descriptive test names that explain the scenario
4. **Arrange-Act-Assert**: Structure tests with setup, execution, and verification phases
5. **Edge Cases**: Test boundary conditions, invalid inputs, and error paths
6. **Security**: Test for XSS, injection attacks, and authorization bypasses
7. **Performance**: Use random ports to allow parallel test execution
8. **Timeouts**: Set appropriate timeouts for integration tests (30s default)

## Continuous Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Pre-commit hooks (if configured)

Coverage reports should be reviewed for:
- Coverage regression
- Untested critical paths
- Missing edge cases

## Adding New Tests

1. Determine test type (unit vs integration)
2. Choose appropriate directory based on module
3. Create `.spec.ts` file with descriptive name
4. Follow existing test patterns and templates
5. Run tests locally before committing
6. Check coverage impact with `pnpm test:coverage`
