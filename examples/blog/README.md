# Blog Example

A relational Blueprint example with users, posts, author queries, draft/published
states, and list/detail/form pages. TOML and JSON variants are included.

For a first working app with signup and sample posts, follow the
[quickstart](https://docs.zebric.dev/getting-started/quickstart/). This example is
for exploring a larger data model; its `User` entity is application data and is
separate from Better Auth accounts.

## Run from source

Use Node.js 24 and pnpm 11.23.0. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter blog-example... build
pnpm --filter blog-example dev
```

Open http://localhost:3000. The package script runs `blueprint.json`. To inspect
the TOML variant instead, run:

```bash
node packages/cli/dist/index.js dev --blueprint examples/blog/blueprint.toml
```

## Pages

| Path | Purpose | Page auth |
| --- | --- | --- |
| `/` and `/posts` | Published posts | Public |
| `/posts/:id` | Post and author detail | Public |
| `/posts/new` | Create form | Optional |
| `/posts/:id/edit` | Edit form | Required |
| `/posts/:id/delete` | Delete confirmation | Required |
| `/users/:id` | Author profile | Public |
| `/dashboard` | Content management | Required |

Entity access rules still apply independently of page auth. Inspect the selected
Blueprint before using these rules in your application.

## Data and authentication

The database starts empty, without seed records. Email/password authentication
is configured, and Zebric supplies `/auth/sign-up` and `/auth/sign-in`. Creating
a post also requires an application `User` record for the `authorId` reference;
signing up alone does not create that record. Decide how accounts relate to
application authors before extending this example. Its create policy is public;
use the quickstart for an example with explicit authenticated writes.

## Continue

- [Blueprint reference](https://docs.zebric.dev/building/blueprint/)
- [Authentication and access control](https://docs.zebric.dev/building/security/)
- [Runtime and deployment](https://docs.zebric.dev/run/runtime/)
- [Cloudflare blog](../workers-blog/README.md) for a standalone example with
  signup, ownership, migrations, and deployment instructions
