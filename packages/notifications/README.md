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
