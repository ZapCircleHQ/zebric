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

## Documentation

Full docs at [docs.zebric.dev](https://docs.zebric.dev)

## License

MIT
