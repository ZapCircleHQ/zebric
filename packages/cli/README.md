# @zebric/cli

Command-line tools for Zebric. Start a development server or validate your blueprint from the terminal.

## Installation

```bash
npm install -g @zebric/cli
# or use without installing:
npx @zebric/cli <command>
```

## Commands

### `zebric init [directory]`

Create the quickstart app in a new or empty directory, without prompts or an
automatic dependency install:

```bash
npx @zebric/cli init my-app
cd my-app
npm install
npm run validate
npm run dev
```

Omit the directory to use the current empty directory. The starter includes
`blueprint.toml`, a pinned CLI dependency and package scripts, a README, and a
`.gitignore` for local data/dependencies/secrets. Existing nonempty directories,
files, and symlink destinations are refused. No AI credential is needed.

### Blueprint selection

`dev`, `validate`, and `audit` automatically use the only `blueprint.toml` or
`blueprint.json` in the current directory. If both exist, specify `--blueprint`;
if neither exists, select an existing file or create a project with `init`.
Explicit paths always take precedence.

### `zebric dev`

Start a development server with hot reload.

```bash
zebric dev --blueprint blueprint.toml --port 3000
```

| Option | Default | Description |
|--------|---------|-------------|
| `--blueprint`, `-b` | Auto-detect | Path to your TOML or JSON blueprint |
| `--port`, `-p` | `3000` | App port; 0 selects a free port |
| `--admin-port` | App port + 30 | Admin server port; 0 selects a free port |
| `--host`, `-h` | `localhost` | Host to bind to |
| `--seed` | — | Seed the database with sample data |

Ports must be whole numbers from 0 to 65535. Set `--admin-port` explicitly if
app port + 30 would exceed 65535. App and admin ports must differ unless both
are 0. Startup checks Blueprint validity and port availability before opening
the database.

### `zebric validate`

Validate a blueprint file without starting a server.

```bash
zebric validate --blueprint blueprint.toml
```

### `zebric audit`

`zebric audit --blueprint blueprint.toml` validates and statically audits a
blueprint without starting the runtime or calling a model. Use `--format json`
for structured findings, `--output audit.json` to save a report, and
`--check audit.json` to require an exact semantic JSON match. `--fail-on warning`
also fails on warnings (default: `error`; choices: `error`, `warning`, `info`,
`none`). Validation and snapshot errors always fail.

Rules cover entity access declarations, public mutation policies, page query
bounds and ordering, reference indexes, workflow triggers and webhook secret
configuration, and plugin trust. Findings include stable rule IDs, severities,
blueprint paths, explanations, and suggestions. They flag review candidates;
they do not certify deployment security.

Repository contributors can check all example snapshots with `pnpm audit:examples`
and explicitly refresh them with `pnpm audit:examples:update` after building the
CLI. Each example's aggregate `audit.json` covers all root blueprint variants.

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
