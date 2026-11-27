# Zebric example catalog

For a first working app, follow the [quickstart](https://docs.zebric.dev/getting-started/quickstart/).
Then use [Humans and Agents](https://docs.zebric.dev/guides/human-and-agent/) to
feature a post through both a browser button and a generated agent tool, with
shared permissions and no model credentials.

The [full catalog](https://docs.zebric.dev/getting-started/examples/) includes setup
commands, runtime choices, and extension/deployment links.

| Goal | Example | Runtime | Access model |
| --- | --- | --- | --- |
| Kanban board and MCP tools | [Task Tracker](task-tracker/README.md) | Node + SQLite | Public browser demo; scoped agent key |
| Relations and author queries | [Blog](blog/README.md) | Node + SQLite | Email auth; separate application author records; read setup limitations |
| Dynamic columns and agent QA workflows | [Issue Board](issue-board/README.md) | Node + SQLite | Public browser demo; scoped agent operations |
| Private per-user tasks on Workers | [Workers starter](../starters/cloudflare-workers/README.md) | Workers + D1 | Authenticated owner-only data |
| Multi-author publishing on Workers | [Workers Blog](workers-blog/README.md) | Workers + D1 | Public published posts; author-owned drafts/writes |
| Guided intake and approval workflows | [Internal tools course](https://docs.zebric.dev/courses/tutorial-ops/) | Node + SQLite | Adds auth and guarded operations across lessons |

For repository development, use Node.js 24 and pnpm 11.23.0. From the repo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter task-tracker... build
pnpm --filter task-tracker dev
```

Build and run `blog-example` or `issue-board-example` instead to explore those
apps. Their READMEs cover data setup and limitations. Run one default-port Node
app at a time. For Workers, follow the selected app's `.dev.vars`, migration,
and Wrangler instructions; its setup is distinct from the Node CLI.

Other directories contain specialized or larger application explorations. The
paths above are the curated entrypoints, rather than a claim that every example
has the same setup, permissions, or deployment support.
