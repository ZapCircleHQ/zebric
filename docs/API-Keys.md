# API Key Authentication

API keys let agents and external services authenticate against skill routes without a browser-based login flow.

## Blueprint Configuration

Add an `[[auth.apiKeys]]` entry for each key in your `blueprint.toml`:

```toml
[auth]
providers = ["email"]

[[auth.apiKeys]]
name = "dispatch-agent"
keyEnv = "DISPATCH_AGENT_API_KEY"

[[auth.apiKeys]]
name = "ci-bot"
keyEnv = "CI_BOT_API_KEY"
```

| Field    | Description |
|----------|-------------|
| `name`   | A human-readable identifier for the key. Used as the actor ID in sessions, audit events, and logs. |
| `keyEnv` | The name of the environment variable that holds the secret key value. The key itself is never stored in the blueprint. |

## Setting the Environment Variable

Set the env var before starting the server:

```bash
export DISPATCH_AGENT_API_KEY="sk-your-secret-key-here"
```

If the env var is not set at startup, the key is skipped and a warning is logged. The server still starts normally.

## Using an API Key

Pass the key as a Bearer token in the `Authorization` header:

```bash
curl -X POST http://localhost:3000/api/issues/01J.../status \
  -H "Authorization: Bearer sk-your-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'
```

## How It Works

1. At startup, the runtime reads `auth.apiKeys` from the blueprint, resolves each `keyEnv` from `process.env`, and stores the resolved keys in memory.
2. When a request hits a skill route, the runtime checks the `Authorization` header before falling back to session-based auth.
3. If the bearer token matches a configured API key, a synthetic session is created with `user.id` and `user.name` set to the key's `name` field. This session flows through to workflows, audit events, and access control like any regular user session.

## Scope

API key auth applies to **skill routes only** (routes registered from `[skill.*]` actions). Standard page routes and `/api/auth/*` routes are unaffected.

## Synthetic Session Shape

When an API key matches, the session looks like:

```json
{
  "id": "apikey-dispatch-agent",
  "userId": "dispatch-agent",
  "user": {
    "id": "dispatch-agent",
    "name": "dispatch-agent",
    "email": ""
  }
}
```

This means `{{ variables.data.user.id }}` in workflow templates resolves to the key name (e.g., `dispatch-agent`), which becomes the `actorId` in audit events.

## Security Notes

- Keep key values long and random. A UUID or 32+ character random string is a reasonable minimum.
- Keys are checked via exact string match in memory. There is no hashing step, so treat the env var as a secret.
- Rotate keys by changing the env var and restarting the server.
- CSRF protection is automatically skipped for Bearer token requests, so API keys work from non-browser clients without a CSRF token.
