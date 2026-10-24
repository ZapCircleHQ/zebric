# Friendly Paws Dog Rescue

Friendly Paws is a Zebric demo app for rescue operations: dog profiles, public adoption interest, internal review, simulated email generation, workflow-created tasks, audit/activity history, and workflow history.

## Run

```bash
pnpm install
pnpm --filter dog-rescue-example dev
```

Run these commands from the repository root with Node.js 22+, pnpm, Python 3,
and `sqlite3` installed. The development command builds the CLI and all its
runtime dependencies before starting the example.

In another shell:

```bash
pnpm --filter dog-rescue-example seed
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
5. Open the new application. Use `Start Review` for a Submitted application;
   applications with existing pets already enter Meet & Greet Required and can
   proceed to `Approve`.
6. Confirm the application status, dog status, generated message, pickup task, activity events, and workflow execution records.

## Blueprint Scope

The app is implemented with blueprint-defined entities, pages, forms, workflows, permissions, simulated messages, and seed data. No app-specific backend or frontend code is required.

## Validation

```bash
pnpm --filter dog-rescue-example validate
pnpm --filter dog-rescue-example test
```

The smoke test starts a temporary database and isolated server, seeds staff and
operational data, submits public interest for Cooper, and checks the pet/rental
rules, volunteer permissions and reviewer linkage, approval, completion, and
messages addressed to the actual applicant. Set `SMOKE_PORT` to override 4931
(the admin port is 30 higher).

Workflows use transactions to keep operational records, simulated messages,
tasks, and activity together. The public submission workflow runs after the
interest record is created. Messages use the selected dog's name and the
linked applicant's email. `WorkflowExecution` is an application-level history
projection, separate from the runtime's durable workflow records.

Set `BASE` (default `http://localhost:3000`), `DB_PATH`, or `DEMO_PASSWORD` to
override seed defaults. The seed creates a fresh set of operational records
each time; use a fresh database for a clean demo.

Lifecycle status and review fields are command-only; dog/application parent links
are immutable. Public interest checks stored availability, and the transactional
workflow claims the dog for one application before creating side effects. A
concurrent losing submission may remain as an interest record, but cannot create
a second application or reopen an adopted dog. Rejection releases only that application's reservation and makes the dog available again. Staff review joins the immutable
`Volunteer.userId` to the verified login; email is contact information.

Existing demo databases need a trusted migration of Volunteer user IDs and Dog
application reservations before staff workflows can continue. For disposable
demo data, start with a fresh database and rerun the seed. Historical seeded
states are restored locally by the seed rather than through public lifecycle APIs.
