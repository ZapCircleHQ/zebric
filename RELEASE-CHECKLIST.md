# Release Checklist - Zebric v0.2.x

Pre-release verification checklist for the current monorepo layout and CI pipeline.

## Build And Dependency Gates

- [ ] Clean install works
  ```bash
  rm -rf node_modules
  pnpm install --frozen-lockfile
  ```

- [ ] Repo build passes
  ```bash
  pnpm build
  ```

- [ ] TypeScript passes for packages and plugins
  ```bash
  pnpm -r --filter './packages/*' --filter './plugins/*' exec tsc --noEmit
  ```

- [ ] Repo lint passes
  ```bash
  pnpm lint
  ```

- [ ] Dependency audit reviewed
  ```bash
  pnpm audit
  ```

## Automated Verification

- [ ] Core runtime tests pass
  ```bash
  pnpm --filter @zebric/runtime-core test
  ```

- [ ] Node runtime tests pass
  ```bash
  pnpm --filter @zebric/runtime-node test
  ```

- [ ] Worker runtime tests pass
  ```bash
  pnpm --filter @zebric/runtime-worker test
  ```

- [ ] Worker smoke tests pass
  ```bash
  pnpm --filter @zebric/runtime-worker test:smoke
  ```

- [ ] Docs build and docs checks pass
  ```bash
  pnpm -C packages/docs build
  pnpm -C packages/docs check
  ```

- [ ] CI is green
  Required jobs:
  - [ ] `quality`
  - [ ] `test`
  - [ ] `build`
  - [ ] `blueprint-smoke-test`
  - [ ] `worker-smoke-test`
  - [ ] `docs-quality`
  - [ ] `all-checks`

## Package And CLI Validation

- [ ] Package metadata is current
  - [ ] Root version is correct in `package.json`
  - [ ] Published package versions are correct in each package `package.json`
  - [ ] `repository`, `license`, and `files` fields are correct for publishable packages
  ```bash
  pnpm release:check
  ```

- [ ] Expected build artifacts exist
  ```bash
  ls packages/runtime-core/dist/index.js packages/runtime-core/dist/index.d.ts
  ls packages/runtime-node/dist/index.js packages/runtime-node/dist/index.d.ts
  ls packages/runtime-worker/dist/index.js packages/runtime-worker/dist/index.d.ts
  ls packages/cli/dist/index.js packages/cli/dist/engine-runner.js
  ```

- [ ] CLI help and version output are correct
  ```bash
  node packages/cli/dist/index.js --help
  node packages/cli/dist/index.js --version
  node packages/cli/dist/engine-runner.js --help
  ```

- [ ] Blueprint validation smoke tests pass
  ```bash
  node packages/cli/dist/index.js validate --blueprint examples/task-tracker/blueprint.toml
  node packages/cli/dist/index.js validate --blueprint examples/blog/blueprint.toml
  ```

## Example App Smoke Tests

- [ ] Task Tracker starts and basic CRUD works
  ```bash
  node packages/cli/dist/engine-runner.js --blueprint examples/task-tracker/blueprint.toml --port 3002
  ```

- [ ] Blog example starts and renders list/detail flows
  ```bash
  node packages/cli/dist/engine-runner.js --blueprint examples/blog/blueprint.toml --port 3001
  ```

- [ ] Custom theme example starts and renders the branded theme
  ```bash
  cd examples/custom-theme
  pnpm dev
  ```

- [ ] Cloudflare Workers starter validates or deploy smoke test passes
  ```bash
  node packages/cli/dist/index.js validate --blueprint starters/cloudflare-workers/blueprint.toml
  ```

## Product Readiness Checks

- [ ] Authentication flow works for the intended launch configuration
  - [ ] Sign in
  - [ ] Sign out
  - [ ] Protected routes redirect correctly
  - [ ] Sessions persist correctly

- [ ] Security expectations verified
  - [ ] CSRF protection active where expected
  - [ ] Error responses are sanitized
  - [ ] Security headers are present

- [ ] Database setup verified for the launch environment
  - [ ] SQLite or configured database starts cleanly
  - [ ] Schema sync or migrations succeed
  - [ ] CRUD flows work on real app paths

- [ ] Plugin loading verified for enabled plugins
  - [ ] Plugin registration succeeds
  - [ ] Plugin-provided layouts render correctly

## Docs And Release Artifacts

- [ ] `README.md` reflects current package names and commands
- [ ] `CHANGELOG.md` has release notes for the version being shipped
- [ ] Docs navigation and links work in the built docs site
- [ ] Release tag matches the version being published
- [ ] NPM token and GitHub release permissions are available before tagging
