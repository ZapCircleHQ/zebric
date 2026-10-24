# @zebric/cli

Command-line tools for Zebric. Start a development server or validate your blueprint from the terminal.

## Installation

```bash
npm install -g @zebric/cli
# or use without installing:
npx zebric <command>
```

## Commands

### `zebric dev`

Start a development server with hot reload.

```bash
zebric dev --blueprint blueprint.toml --port 3000
```

| Option | Default | Description |
|--------|---------|-------------|
| `--blueprint`, `-b` | `blueprint.json` | Path to your blueprint file |
| `--port`, `-p` | `3000` | Port to listen on |
| `--host`, `-h` | `localhost` | Host to bind to |
| `--seed` | — | Seed the database with sample data |

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
