# @zebric/notifications

Notification delivery adapters for Zebric. Supports email, Slack, and console output out of the box.

## Installation

```bash
npm install @zebric/notifications
```

## Adapters

| Adapter | Use Case |
|---------|----------|
| `EmailAdapter` | Transactional email (SMTP/provider-agnostic) |
| `SlackAdapter` | Slack webhook notifications |
| `ConsoleAdapter` | Local development / logging |

## Usage

Configure notifications in your `blueprint.toml`:

```toml
[notifications]
adapter = "email"
from = "noreply@yourapp.com"
```

Or use the `NotificationManager` directly:

```typescript
import { NotificationManager } from '@zebric/notifications'

const notifications = new NotificationManager({ adapter: 'console' })

await notifications.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
})
```

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT

## Portable runtimes

Import `createPortableNotificationManager` from `@zebric/notifications/portable`
for an entrypoint without Node filesystem dependencies. Pass configuration, an
environment binding map, and optional per-instance adapter factories. Console and
Slack are built in; Slack verifies inbound signatures with Web Crypto. Portable
configuration errors fail initialization instead of silently dropping adapters.
Workers initializes this manager automatically and supplies its private R2 email
outbox adapter. Node's default entrypoint retains the filesystem email outbox.
