# Friendly Paws Dog Rescue

Friendly Paws is a Zebric demo app for rescue operations: dog profiles, public adoption interest, internal review, simulated email generation, workflow-created tasks, audit/activity history, and workflow history.

## Run

```bash
cd examples/dog-rescue
pnpm install
pnpm dev
```

In another shell:

```bash
cd examples/dog-rescue
pnpm seed
```

The seed script prints Bella's dog detail URL and provisions three staff logins (see below). Use Bella's page's `I'm Interested` action to submit the public adoption form and trigger the workflow.

## Staff logins

`/dogs` and a dog's detail/interest pages are public - no login needed to browse dogs or submit interest. Everything else (`/`, `/applications`, `/tasks`, `/messages`, `/activity`, `/workflow-history`, `/applicants`, `/volunteers`) requires signing in at `/auth/sign-in`. The seed script creates three accounts, password `FriendlyPaws!Demo1` for all of them:

| Email | Role | Can do |
| --- | --- | --- |
| `maya@friendlypaws.example` | volunteer | Review applications (`Start Review`), work tasks |
| `eli@friendlypaws.example` | coordinator | Everything a volunteer can, plus approve/reject/require a visit/complete adoptions, and change a dog's availability |
| `rina@friendlypaws.example` | admin | Full access |

Staff roles are never client-settable (sign-up always defaults to a permission-less `user` role); the seed script assigns them via a direct, trusted database write, standing in for what a real deployment would do through an internal admin tool.

## Demo Flow

1. Open `/dogs` and pick Bella (no login required).
2. Submit the public adoption interest form from Bella's page.
3. Sign in as `eli@friendlypaws.example` (coordinator) at `/auth/sign-in`.
4. Open `/` for the dashboard, then review records in `/applications`, `/messages`, `/tasks`, `/activity`, and `/workflow-history`.
5. Open the new application and use `Start Review`, then `Approve`.
6. Confirm the application status, dog status, generated message, pickup task, activity events, and workflow execution records.

## Blueprint Scope

The app is implemented with blueprint-defined entities, pages, forms, workflows, permissions, simulated messages, and seed data. No app-specific backend or frontend code is required.
