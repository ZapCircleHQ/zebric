# Release Checklist - Zebric v0.1.0

Pre-release smoke tests and verification checklist before pushing to GitHub and publishing to NPM.

## 🏗️ Build & Dependencies

- [ ] **Clean install works**
  ```bash
  rm -rf node_modules pnpm-lock.yaml
  pnpm install
  ```

- [ ] **All packages build successfully**
  ```bash
  pnpm build
  ```
  - [ ] `@zebric/runtime` builds
  - [ ] `@zebric/cli` builds
  - [ ] All plugins build
  - [ ] Check for TypeScript errors

- [ ] **TypeScript compilation passes**
  ```bash
  pnpm -r exec tsc --noEmit
  ```

- [ ] **No critical dependency vulnerabilities**
  ```bash
  pnpm audit
  ```

## 🧪 Automated Tests

- [ ] **All unit tests pass**
  ```bash
  pnpm test
  ```

- [ ] **All integration tests pass**
  ```bash
  pnpm --filter @zebric/runtime test
  ```
  - [ ] Authorization tests (12 tests)
  - [ ] CRUD operations tests
  - [ ] Auth flows tests
  - [ ] Error handling tests
  - [ ] Field-level access tests

- [ ] **CI pipeline passes**
  - [ ] Check GitHub Actions status (if already pushed)
  - [ ] All jobs green: quality, test, build, blueprint-smoke-test

## 📦 Package Metadata

### @zebric/runtime

- [ ] **package.json is correct**
  - [ ] `name`: `@zebric/runtime`
  - [ ] `version`: `0.1.0`
  - [ ] `description` is accurate
  - [ ] `main` and `types` point to correct files
  - [ ] `exports` field is properly configured
  - [ ] `dependencies` are all listed (not in devDependencies)
  - [ ] `peerDependencies` if any are correct
  - [ ] `repository` URL is set
  - [ ] `license` is MIT
  - [ ] `author` is correct

- [ ] **README.md exists in package**
  ```bash
  ls packages/runtime/README.md
  ```

- [ ] **Build artifacts exist**
  ```bash
  ls packages/runtime/dist/index.js
  ls packages/runtime/dist/index.d.ts
  ```

### @zebric/cli

- [ ] **package.json is correct**
  - [ ] `name`: `@zebric/cli`
  - [ ] `version`: `0.1.0`
  - [ ] `bin` commands are set (`zebric`, `zebric-engine`)
  - [ ] `dependencies` include `@zebric/runtime`
  - [ ] Shebang lines in bin files (`#!/usr/bin/env node`)

- [ ] **CLI commands are executable**
  ```bash
  node packages/cli/dist/index.js --help
  node packages/cli/dist/engine-runner.js --help
  ```

## 🎯 Example Applications Smoke Tests

### Blog Example
- [ ] **Blueprint loads without errors**
  ```bash
  cd examples/blog
  node ../../packages/cli/dist/engine-runner.js --blueprint=blueprint.toml --port=3001
  ```

- [ ] **Server starts successfully**
  - [ ] No errors in console
  - [ ] Listening on correct port
  - [ ] Database initializes

- [ ] **Basic functionality works**
  - [ ] Navigate to http://localhost:3001
  - [ ] Home page loads
  - [ ] Can view list of posts
  - [ ] Can create a new post (if auth not required)
  - [ ] Can view a single post
  - [ ] Hot reload works (change blueprint, see update)

### Task Tracker Example
- [ ] **Blueprint loads without errors**
  ```bash
  cd examples/task-tracker
  node ../../packages/cli/dist/engine-runner.js --blueprint=blueprint.toml --port=3002
  ```

- [ ] **Server starts successfully**

- [ ] **Basic CRUD works**
  - [ ] Can create a task
  - [ ] Can view tasks
  - [ ] Can update a task
  - [ ] Can delete a task

### Custom Theme Example
- [ ] **Custom theme loads**
  ```bash
  cd examples/custom-theme
  node ../../packages/cli/dist/engine-runner.js --blueprint=blueprint.toml --port=3003
  ```

- [ ] **Theme is applied**
  - [ ] Custom styling is visible
  - [ ] Page renders with custom theme

## 🔐 Authentication & Security

- [ ] **Email auth flow works**
  - [ ] Sign up with email/password
  - [ ] Sign in with email/password
  - [ ] Sign out
  - [ ] Session persists across page reloads
  - [ ] Protected routes redirect to login

- [ ] **Access control works**
  - [ ] Unauthenticated users get 401 on protected endpoints
  - [ ] Non-owners get 403 on restricted resources
  - [ ] Admin-only actions are enforced

- [ ] **Security headers are set**
  - [ ] CSP header present
  - [ ] X-Content-Type-Options: nosniff
  - [ ] X-Frame-Options: DENY
  - [ ] CSRF protection active

## 🗄️ Database

- [ ] **SQLite works**
  - [ ] Schema is created automatically
  - [ ] CRUD operations work
  - [ ] Migrations don't break (if applicable)

- [ ] **PostgreSQL works** (if supported)
  - [ ] Can connect to PostgreSQL
  - [ ] Schema is created
  - [ ] CRUD operations work

## 🔌 Plugins

- [ ] **Card Grid Layout Plugin**
  - [ ] Plugin loads without errors
  - [ ] Renders correctly

- [ ] **Plugin API works**
  - [ ] Plugins can register
  - [ ] Init hooks are called
  - [ ] Custom layouts are respected

## 📚 Documentation

- [ ] **README.md is up to date**
  - [ ] Installation instructions work
  - [ ] Quick start is accurate
  - [ ] Examples are correct
  - [ ] Links are not broken

- [ ] **QUICKSTART.md works**
  - [ ] Can follow along and build an app
  - [ ] Commands are correct

- [ ] **API documentation exists** (at minimum in code comments)
  - [ ] Core classes are documented
  - [ ] Public methods have JSDoc

- [ ] **CHANGELOG.md is updated**
  - [ ] v0.1.0 release notes added
  - [ ] Breaking changes noted (if any)

## 🚀 CLI Tools

- [ ] **`zebric dev` command works**
  ```bash
  cd examples/blog
  npx @zebric/cli dev blueprint.toml
  ```

- [ ] **`zebric-engine` command works**
  ```bash
  npx zebric-engine --blueprint=examples/blog/blueprint.toml
  ```

- [ ] **Help text is clear**
  ```bash
  npx @zebric/cli --help
  ```

## 🔄 Hot Reload

- [ ] **Blueprint changes trigger reload**
  - [ ] Start an app in dev mode
  - [ ] Edit blueprint.toml
  - [ ] Save file
  - [ ] Browser refreshes automatically (or WebSocket notifies)
  - [ ] Changes are reflected

- [ ] **WebSocket connects**
  - [ ] No WebSocket errors in console
  - [ ] Reload notifications appear in browser

## 🌐 HTTP & Routing

- [ ] **All HTTP methods work**
  - [ ] GET requests
  - [ ] POST requests (form submission)
  - [ ] PUT requests (update)
  - [ ] DELETE requests

- [ ] **Dynamic routes work**
  - [ ] `/posts/:id` matches correctly
  - [ ] Params are passed to handlers
  - [ ] 404 for non-existent routes

- [ ] **Query parameters work**
  - [ ] `?page=2` is parsed
  - [ ] Available in queries

## 🎨 HTML Rendering

- [ ] **All layouts render**
  - [ ] `list` layout
  - [ ] `detail` layout
  - [ ] `form` layout
  - [ ] `dashboard` layout

- [ ] **Tailwind CSS loads**
  - [ ] CDN script is in HTML
  - [ ] Styles are applied

- [ ] **View Transitions work** (in supporting browsers)
  - [ ] Page transitions are smooth
  - [ ] `document.startViewTransition` is used

## 📊 Monitoring & Debugging

- [ ] **Admin endpoints work**
  - [ ] `/health` returns 200
  - [ ] `/metrics` returns Prometheus format
  - [ ] Admin server starts (in dev mode)

- [ ] **Request tracing works**
  - [ ] Traces are created
  - [ ] Spans are logged
  - [ ] Can view traces in admin UI (if applicable)

- [ ] **Error handling works**
  - [ ] Errors are sanitized (no stack traces in production mode)
  - [ ] Proper status codes returned
  - [ ] Audit logs capture errors

## 📋 Pre-NPM Publish Checks

- [ ] **npm pack works**
  ```bash
  cd packages/runtime
  npm pack --dry-run
  ```
  - [ ] Check that only necessary files are included
  - [ ] `.npmignore` or `files` field in package.json is correct

- [ ] **Local install works**
  ```bash
  # In a temp directory
  mkdir /tmp/zebric-test
  cd /tmp/zebric-test
  npm init -y
  npm install /path/to/zbl-engine/packages/runtime
  npm install /path/to/zbl-engine/packages/cli
  ```

- [ ] **NPM registry credentials are set**
  ```bash
  npm whoami
  ```

- [ ] **Scoped package access**
  - [ ] `@zebric` scope exists or will be created
  - [ ] NPM organization configured (if needed)

## 🔖 Git & GitHub

- [ ] **All changes committed**
  ```bash
  git status
  # Should be clean
  ```

- [ ] **Version tags created**
  ```bash
  git tag v0.1.0
  ```

- [ ] **CHANGELOG.md committed**

- [ ] **GitHub repository ready**
  - [ ] Repository exists
  - [ ] README.md will display correctly
  - [ ] LICENSE file present
  - [ ] .gitignore is correct

- [ ] **GitHub Actions secrets configured** (if needed)
  - [ ] `NPM_TOKEN` (for automated publishing)
  - [ ] `CODECOV_TOKEN` (if using codecov)

## 🎯 Final Manual Tests

- [ ] **Fresh clone test**
  ```bash
  # Clone repo to new directory
  git clone <repo-url> /tmp/zebric-fresh
  cd /tmp/zebric-fresh
  pnpm install
  pnpm build
  pnpm test
  cd examples/blog
  npx zebric dev blueprint.toml
  ```

- [ ] **Cross-platform test** (if possible)
  - [ ] Works on macOS
  - [ ] Works on Linux
  - [ ] Works on Windows (WSL acceptable)

## 📢 Release Notes

- [ ] **Write release announcement**
  - [ ] What's new
  - [ ] Known limitations
  - [ ] Breaking changes (if any)
  - [ ] Migration guide (if needed)

- [ ] **Update version numbers**
  - [ ] Root package.json: `0.1.0`
  - [ ] packages/runtime/package.json: `0.1.0`
  - [ ] packages/cli/package.json: `0.1.0`
  - [ ] All plugins: `0.1.0`

## 🚢 Publishing Steps (Do Last!)

```bash
# 1. Ensure you're on main branch
git checkout main

# 2. Build everything
pnpm build

# 3. Run all tests one more time
pnpm test

# 4. Publish to NPM (dry run first)
cd packages/runtime
npm publish --dry-run --access public

cd ../cli
npm publish --dry-run --access public

# 5. If dry run looks good, publish for real
cd packages/runtime
npm publish --access public

cd ../cli
npm publish --access public

# 6. Push to GitHub
git push origin main
git push origin v0.1.0

# 7. Create GitHub Release
# - Go to GitHub releases
# - Create new release from tag v0.1.0
# - Add release notes
# - Attach any relevant files
```

---

## ✅ Sign-off

- [ ] All tests above have been checked
- [ ] No critical issues found
- [ ] Ready to publish

**Date:** ___________
**Verified by:** ___________
