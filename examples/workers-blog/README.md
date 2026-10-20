# Cloudflare Workers Blog

A small multi-author blog. Anyone can read published posts. Signed-in users can create posts; drafts, edits and deletes belong to their author. Signup is open, so every registered user can publish their own posts.

This app uses `@zebric/runtime-worker` 0.9.0, D1 and Better Auth email/password
sessions. It shares the starter's entrypoint, TypeScript setup, auth migration and
deployment commands. `pnpm-workspace.yaml` pins Better Auth to 1.6.6 to match
the checked-in migration and tested adapter; retain it in standalone copies. No KV, R2 or background job bindings are needed.

## Start locally

Requires Node.js 22+ and pnpm. Copy this directory outside the repository for a
standalone project, or work in it after installing dependencies at the repository root.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate
pnpm dev
```

Open http://localhost:8787/auth/sign-up to register, then sign in at
http://localhost:8787/auth/sign-in. Local auth uses the explicit development values
in `.dev.vars`; that file is ignored by Git. The entrypoint refuses to start without
an origin and a secret of at least 32 characters. HTTP auth origins are allowed
only for localhost/loopback. The local D1 database persists under `.wrangler/`.

```bash
pnpm check       # TypeScript
pnpm build       # deployment dry run; does not publish
```

## Deploy

Use a new D1 database for this rebuilt example. These migrations are not an
upgrade path for the previous starter/blog schema. Preserve existing production
data and write a migration plan before switching an existing deployment.

```bash
pnpm exec wrangler login
pnpm db:create
```

Copy the ID for `zebric-blog-db` into `wrangler.toml`. Set your Worker name there.
Uncomment `[vars]` and set `BETTER_AUTH_URL` to the exact public HTTPS origin,
such as `https://my-app.my-subdomain.workers.dev` or your configured custom domain.
Set the production secret independently of `.dev.vars`:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm db:migrate:prod
pnpm build
pnpm run deploy
```

`pnpm db:migrate:prod` and `pnpm run deploy` first run `scripts/predeploy.mjs`, which stops with an
explanation if the placeholder database ID or the `BETTER_AUTH_URL` var is still unset.

Use a generated high-entropy secret of at least 32 characters. `.dev.vars` is for
local Wrangler development; it is not production secret provisioning. Test
`/health`, signup/signin, a form submission, and permissions at the deployed origin.
The checked-in configuration uses top-level bindings. If adding named environments,
repeat their bindings/vars and use the same `--env` for migrations, secrets and deploy.

## Customize

- `blueprint.toml`: entities, permissions, pages and forms.
- `worker.ts`: shared runtime handler and explicit auth configuration checks.
- `migrations/0000_auth.sql`: Better Auth 1.6.6 schema, including Zebric's `role` field.
- `migrations/0001_initial.sql`: application tables and indexes.
- `wrangler.toml`: D1 binding, compatibility settings and production origin.

Create a new numbered migration whenever the application schema changes. Review
and regenerate the auth schema on Better Auth/runtime upgrades, using the
[Better Auth schema tooling](https://better-auth.com/docs/concepts/database).
Wrangler tracks applied migrations, so local and remote migration commands can
be run again. The runtime does not automatically synchronize D1 entity schema.

Ownership (`userId`), IDs and creation timestamps are assigned by the runtime and
are unwritable through forms/API input. Auth users are separate from Blueprint
entities. Application ownership columns intentionally have no SQL foreign key to
Better Auth tables, because snapshot transactions support Blueprint entity tables.
Account deletion/data retention requires an application-specific policy.

Generic CRUD is available at `/api/posts` and
`/api/posts/:id`. Cookie-authenticated writes require
the `csrf-token` cookie and matching `X-CSRF-Token` header (forms supply it automatically).
See `blueprint.toml` for page routes. These examples do not send verification/reset
email; add an email delivery integration and a signup policy suitable for your app.

## Repository verification

From the repository root:

```bash
pnpm test:workers-apps
```

The check packs the runtime and its shared packages, installs copies of both apps
outside the workspace, checks types, bundles with Wrangler, applies local migrations,
and runs real email/password signup, signin, logout, CSRF, ownership and CRUD checks
inside Wrangler/workerd. Packed local packages replace release dependencies only
in that verification directory, so unpublished changes can be tested before release.

Read the [Cloudflare deployment guide](https://docs.zebric.dev/run/cloudflare/) for
runtime constraints and optional R2/Workflows configuration.
