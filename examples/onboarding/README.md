# Developer Onboarding Example

This example blueprint demonstrates how to model a lightweight onboarding pipeline inside Zebric. It tracks new developers, their access requests, onboarding tasks, and simple workflows/notifications.

## Running the example

From the repository root:

```bash
# Install dependencies if needed
pnpm install

# Run the blueprint with the Zebric CLI
node packages/cli/dist/index.js dev --blueprint examples/onboarding/blueprint.toml --port 3000
```

The CLI starts the runtime on `http://localhost:3000` using the blueprint in this folder. The example uses the console notification adapter, so workflow notifications will show up in the terminal.

## Seeding sample data

After the runtime creates the SQLite database (`examples/onboarding/data/app.db`), stop the server and run:

```bash
sqlite3 examples/onboarding/data/app.db < examples/onboarding/seed.sql
```

This seeds two developers plus onboarding tasks, access items, and ramp milestones so the UI is populated when you restart the runtime:

```bash
node packages/cli/dist/index.js dev --blueprint examples/onboarding/blueprint.toml --port 3000
```

## Blueprint features

- `Developer`, `AccessItem`, `OnboardingTask`, and `RampMilestone` entities
- Dashboard, list, detail, and create pages
- Simple workflow that seeds onboarding tasks when a developer is created and logs a notification
- Console notification adapter (easy to swap for Slack/email once configured)

Use this blueprint as a starting point for internal onboarding tools—extend entities, add more workflows, or wire the notification adapter to Slack when you’re ready.
