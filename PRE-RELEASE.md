# Pre-Release Quick Reference

Essential checks before releasing Zebric v0.1.0 to GitHub and NPM.

## 🚨 Critical (Must Pass)

### Automated Tests

**Fast check (recommended for quick validation):**
```bash
./smoke-test-fast.sh
```
This runs unit tests only (~30 seconds, reliable).

**Full check (before final release):**
```bash
./smoke-test-full.sh
```
This runs all tests including integration tests (~3-5 minutes, may be flaky).

**Must pass:**
- ✅ Unit tests passing (`pnpm --filter @zebric/runtime test:unit`)
- ✅ All packages build successfully
- ✅ CLI commands work
- ✅ No critical dependency vulnerabilities

**Nice to have (integration tests can be flaky):**
- ⚠️ Integration tests passing (manual verification recommended)
  - Run examples manually to verify instead of relying on integration tests

### Example Apps (Manual)
Test each example manually to ensure they work:

```bash
# Blog Example
cd examples/blog
npx zebric dev blueprint.toml
# Visit http://localhost:3000
# - Create a post
# - View post list
# - Edit title in blueprint.toml and verify hot reload

# Task Tracker
cd examples/task-tracker
npx zebric dev blueprint.toml
# Visit http://localhost:3000
# - Sign up/sign in
# - Create a task
# - Update a task
# - Delete a task
```

### Package Publishing
```bash
# Test that packages can be installed locally
cd packages/runtime
npm pack --dry-run

cd ../cli
npm pack --dry-run
```

**Check output:**
- ✅ Only necessary files included (dist/, package.json, README.md)
- ✅ No test files or source .ts files
- ✅ No node_modules

## ⚠️ Important (Should Pass)

### Documentation
- [ ] README.md accurately describes the project
- [ ] QUICKSTART.md works step-by-step
- [ ] CHANGELOG.md has v0.1.0 notes
- [ ] All example README files are current

### Package Metadata
Verify in package.json files:
- [ ] Version is `0.1.0` everywhere
- [ ] Repository URL is correct
- [ ] License is MIT
- [ ] Author/organization is correct
- [ ] `files` or `.npmignore` is properly set

### Security
```bash
# Check for known vulnerabilities
pnpm audit

# Verify security headers in a running app
curl -I http://localhost:3000 | grep -E "X-Content|X-Frame|Content-Security"
```

## 📋 Pre-NPM Publish

### Version Bump (if not already done)
```bash
# Update version in all package.json files
cd packages/runtime && npm version 0.1.0 --no-git-tag-version
cd ../cli && npm version 0.1.0 --no-git-tag-version
```

### Build Fresh
```bash
# Clean and rebuild everything
pnpm clean
pnpm install
pnpm build
pnpm test
```

### Git Tagging
```bash
# Ensure everything is committed
git status

# Create and push tag
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

## 🚀 Publishing Commands

### NPM Publish
```bash
# Login to NPM (if needed)
npm login

# Publish runtime
cd packages/runtime
npm publish --access public

# Publish CLI
cd ../cli
npm publish --access public
```

### Verify Published Packages
```bash
# Check NPM registry
npm view @zebric/runtime
npm view @zebric/cli

# Test install in fresh directory
mkdir /tmp/test-zebric-install
cd /tmp/test-zebric-install
npm init -y
npm install @zebric/runtime @zebric/cli
```

## 🎯 Post-Release

- [ ] Create GitHub Release with release notes
- [ ] Test fresh install from NPM: `npm install -g @zebric/cli`
- [ ] Announce on appropriate channels
- [ ] Update project board/issues

---

## Quick Command Reference

```bash
# Full automated smoke test
./smoke-test.sh

# Manual full test flow
pnpm clean && pnpm install && pnpm build && pnpm test

# Check package contents
npm pack --dry-run

# Publish (dry run)
npm publish --dry-run --access public

# Actual publish
npm publish --access public
```

## Common Issues

**"Unable to authenticate"**
→ Run `npm login` and enter your NPM credentials

**"Package already exists"**
→ Version number must be incremented

**"Access denied to @zebric scope"**
→ Ensure you have access to the @zebric organization on NPM, or create it first

**"Tests failing locally but pass in CI"**
→ Check Node version, clear node_modules, ensure pnpm lockfile is up to date
