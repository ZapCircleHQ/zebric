# Security Integration Guide

This document describes how the security modules are integrated into the Zebric Runtime Engine.

## Security Modules Created

### 1. Audit Logger (`src/security/audit-logger.ts`)
- Write-once, read-many audit trail
- Logs authentication, authorization, and data access events
- Separate from application logs (configurable)
- JSON format for easy parsing
- Automatic sensitive field redaction

### 2. HTML Escaping (`src/security/html-escape.ts`)
- Prevents XSS attacks
- Functions: `escapeHtml()`, `escapeHtmlAttr()`, `escapeJs()`, `escapeUrl()`
- CSP header builder
- XSS pattern detection

### 3. Input Validator (`src/security/input-validator.ts`)
- Comprehensive input validation
- Type checking, length limits, pattern matching
- XSS detection in inputs
- Request body size validation

### 4. Error Sanitizer (`src/security/error-sanitizer.ts`)
- Prevents information disclosure
- Removes stack traces, file paths, connection strings
- Development vs production modes
- Safe error logging

## Integration Points

### Engine Integration

```typescript
// src/engine.ts
import { AuditLogger, CSPBuilder, ErrorSanitizer } from './security/index.js'

class ZebricEngine {
  private auditLogger: AuditLogger
  private errorSanitizer: ErrorSanitizer

  constructor(config: EngineConfig) {
    // Initialize audit logger
    this.auditLogger = new AuditLogger({
      logPath: config.dev?.auditLogPath || './data/audit.log',
      enabled: true,
      splitLogs: config.dev?.splitAuditLogs !== false,
    })

    // Initialize error sanitizer
    this.errorSanitizer = new ErrorSanitizer(config.dev?.mode === 'development')
  }

  // Add CSP headers to Fastify
  private async startServer(): Promise<void> {
    this.server = Fastify({...})

    // Add security headers
    this.server.addHook('onRequest', async (request, reply) => {
      const csp = new CSPBuilder()
        .directive('default-src', ["'self'"])
        .directive('script-src', ["'self'"])
        .build()

      reply.header('Content-Security-Policy', csp)
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('X-Frame-Options', 'DENY')
      reply.header('X-XSS-Protection', '1; mode=block')
    })
  }
}
```

### Route Handler Integration

```typescript
// src/server/route-handler.ts
import { AuditLogger, AuditEventType, InputValidator, ErrorSanitizer } from '../security/index.js'

export class RouteHandler {
  private auditLogger: AuditLogger
  private errorSanitizer: ErrorSanitizer

  async handleGet(match: RouteMatch, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const session = await this.getSession(request)

      // Log access attempt
      const context = AuditLogger.extractContext(session, request)

      if (authRequired && !session) {
        this.auditLogger.logAccessDenied(match.page.path, 'read', undefined, context)
        reply.code(401).send(...)
        return
      }

      // Log successful access
      this.auditLogger.log({
        eventType: AuditEventType.DATA_READ,
        action: `View page: ${match.page.path}`,
        resource: match.page.path,
        success: true,
        ...context,
      })

      // Execute queries and render...
    } catch (error) {
      // Sanitize error
      const sanitized = this.errorSanitizer.sanitize(error)

      // Log if needed
      if (this.errorSanitizer.shouldLog(error)) {
        this.auditLogger.logSuspiciousActivity(
          `Error on ${match.page.path}`,
          AuditSeverity.ERROR,
          {
            ...AuditLogger.extractContext(session, request),
            metadata: this.errorSanitizer.getLogDetails(error),
          }
        )
      }

      reply.code(sanitized.statusCode).send(sanitized)
    }
  }

  async handlePost(match: RouteMatch, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = await this.getSession(request)
    const context = AuditLogger.extractContext(session, request)

    try {
      // Validate input
      const bodyErrors = InputValidator.validateBodySize(request.body, 1024 * 1024) // 1MB
      if (bodyErrors) {
        this.auditLogger.log({
          eventType: AuditEventType.INVALID_INPUT,
          action: 'Request body too large',
          success: false,
          ...context,
        })
        reply.code(413).send({ error: 'Request too large' })
        return
      }

      // Validate form fields
      const validationErrors = this.validateForm(page.form, body)
      if (validationErrors.length > 0) {
        this.auditLogger.log({
          eventType: AuditEventType.INVALID_INPUT,
          action: 'Form validation failed',
          success: false,
          metadata: { errors: validationErrors },
          ...context,
        })
        reply.code(400).send({ errors: validationErrors })
        return
      }

      // Execute form action
      const result = await this.executeFormAction(page.form, body, {...})

      // Log success
      this.auditLogger.logDataAccess(
        'create',
        page.form.entity,
        result.id,
        session?.user?.id,
        true,
        context
      )

      reply.send({ success: true, data: result })
    } catch (error) {
      const sanitized = this.errorSanitizer.sanitize(error)

      this.auditLogger.logDataAccess(
        'create',
        page.form.entity,
        undefined,
        session?.user?.id,
        false,
        {
          ...context,
          errorMessage: sanitized.message,
        }
      )

      reply.code(sanitized.statusCode).send(sanitized)
    }
  }
}
```

### HTML Renderer Integration

```typescript
// src/renderer/html-renderer.ts
import { escapeHtml, escapeHtmlAttr } from '../security/html-escape.js'

export class HTMLRenderer {
  // When rendering user data, always escape
  private renderValue(value: any): string {
    return escapeHtml(value)
  }

  private renderAttribute(name: string, value: any): string {
    return `${name}="${escapeHtmlAttr(value)}"`
  }

  // Example: rendering table cells
  private renderTableCell(value: any): string {
    return `<td>${escapeHtml(value)}</td>`
  }

  // Example: rendering form inputs
  private renderInput(field: FormField, value: any): string {
    return `
      <input
        type="${escapeHtmlAttr(field.type)}"
        name="${escapeHtmlAttr(field.name)}"
        value="${escapeHtmlAttr(value || field.default || '')}"
        ${field.required ? 'required' : ''}
      />
    `
  }
}
```

### Better Auth Secure Cookies

```typescript
// src/auth/config.ts
export function createAuth(config: BetterAuthConfig): ReturnType<typeof betterAuth> {
  return betterAuth({
    database: db,
    baseURL,
    secret,
    trustedOrigins,
    emailAndPassword: {...},
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    // Secure cookie settings
    cookies: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true, // Prevent JavaScript access
      sameSite: 'lax', // CSRF protection
      path: '/',
    },
  })
}
```

## Usage Examples

### Example 1: Audit Trail

```json
// audit.log entries
{"timestamp":"2025-01-06T10:30:00.000Z","eventType":"auth.login.success","severity":"INFO","action":"User logged in","userId":"01HG...","userEmail":"user@example.com","ipAddress":"192.168.1.1","success":true}
{"timestamp":"2025-01-06T10:31:15.000Z","eventType":"access.denied","severity":"WARNING","action":"Access denied: update","resource":"Post/123","userId":"01HG...","success":false}
{"timestamp":"2025-01-06T10:32:00.000Z","eventType":"data.create","severity":"INFO","action":"Data create","entityType":"Post","entityId":"01HH...","userId":"01HG...","success":true}
```

### Example 2: XSS Prevention

```javascript
// Before (vulnerable):
<div>${userInput}</div>

// After (safe):
import { escapeHtml } from './security/html-escape.js'
<div>${escapeHtml(userInput)}</div>
```

### Example 3: Input Validation

```typescript
import { InputValidator } from './security/input-validator.js'

const errors = InputValidator.validate(requestBody, {
  title: { required: true, type: 'string', maxLength: 200 },
  email: { required: true, type: 'email' },
  age: { type: 'number', min: 0, max: 150 },
})

if (errors.length > 0) {
  // Handle validation errors
}
```

## Next Steps

1. ✅ All security modules created
2. 🔲 Add imports to route handler
3. 🔲 Add audit logging calls
4. 🔲 Add CSP headers in engine
5. 🔲 Update renderer to use escapeHtml()
6. 🔲 Configure secure cookies in Better Auth
7. 🔲 Add error sanitizer to all error responses
8. 🔲 Test XSS prevention
9. 🔲 Test audit logging
10. 🔲 Load test with security enabled

## Testing

```bash
# Build with security features
pnpm build

# Start server
node packages/cli/dist/index.js dev --blueprint examples/blog/blueprint.json

# Test audit log
cat data/audit.log | jq

# Test XSS prevention (should be escaped)
curl -X POST http://localhost:3000/api/posts -d '{"title":"<script>alert(1)</script>"}'

# Check security headers
curl -I http://localhost:3000/
```
