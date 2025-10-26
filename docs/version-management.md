# Version Management with Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs across the monorepo.

## Why Changesets?

Changesets solves several problems in monorepo version management:
- ✅ Automatically bumps versions across all packages
- ✅ Handles inter-package dependencies correctly
- ✅ Generates CHANGELOGs automatically
- ✅ Supports linked packages (all packages version together)
- ✅ Works seamlessly with pnpm workspaces
- ✅ Integrates with CI/CD for automated releases

## Workflow

### 1. During Development: Add Changesets

When you make changes that should trigger a version bump, create a changeset:

```bash
pnpm changeset
```

This will:
1. Ask which packages changed
2. Ask if it's a patch, minor, or major change
3. Ask for a summary of changes
4. Create a markdown file in `.changeset/` with your changes

**Example interaction:**
```
🦋  Which packages would you like to include?
◉ @zebric/runtime
◉ @zebric/cli
◯ @zebric/plugin-sdk
◯ @zebric/themes

🦋  What kind of change is this for the selected packages?
◯ patch (bug fixes)
● minor (new features)
◯ major (breaking changes)

🦋  Please enter a summary for this change:
Added file upload support with local storage
```

### 2. Before Release: Apply Changesets

When you're ready to release, apply all pending changesets:

```bash
pnpm version
```

This will:
1. Read all changeset files in `.changeset/`
2. Bump versions in all affected `package.json` files
3. Update `CHANGELOG.md` files
4. Delete the processed changeset files
5. Update interdependencies automatically

### 3. Release to npm

After versions are bumped and you've committed the changes:

```bash
pnpm release
```

This will:
1. Build all packages
2. Publish to npm
3. Create git tags

## Configuration

Our setup (`.changeset/config.json`) uses **linked packages**, meaning all core packages version together:

```json
{
  "linked": [
    ["@zebric/runtime", "@zebric/cli", "@zebric/plugin-sdk", "@zebric/themes"]
  ]
}
```

This means:
- ✅ All packages stay in sync (0.1.0 → 0.1.1 together)
- ✅ No version drift between packages
- ✅ Simpler for users to understand

## Common Scenarios

### Scenario 1: Bug Fix (Patch Release)

```bash
# 1. Fix the bug in your code

# 2. Create a changeset
pnpm changeset
# Select: patch
# Summary: "Fixed authentication redirect bug"

# 3. Commit the changeset
git add .changeset/
git commit -m "Add changeset for auth fix"

# 4. When ready to release (could be multiple changesets)
pnpm version
# This bumps 0.1.0 → 0.1.1

# 5. Commit version changes
git add .
git commit -m "Release v0.1.1"

# 6. Publish
pnpm release
```

### Scenario 2: New Feature (Minor Release)

```bash
# 1. Implement the feature

# 2. Create a changeset
pnpm changeset
# Select: minor
# Summary: "Added file upload support with S3 integration"

# 3. When ready to release
pnpm version
# This bumps 0.1.1 → 0.2.0

# 4. Commit and publish
git add .
git commit -m "Release v0.2.0"
pnpm release
```

### Scenario 3: Multiple Changes Before Release

You can accumulate multiple changesets:

```bash
# Feature A
git checkout -b feature/upload
# ... make changes ...
pnpm changeset  # "Added file uploads"
git commit -am "Add file upload feature"

# Feature B
git checkout main
git merge feature/upload
git checkout -b feature/s3
# ... make changes ...
pnpm changeset  # "Added S3 storage support"
git commit -am "Add S3 storage"

# Bug fix
git checkout main
git merge feature/s3
# ... fix bug ...
pnpm changeset  # "Fixed CORS issue"
git commit -am "Fix CORS bug"

# Now release everything at once
pnpm version
# All three changes are included in the CHANGELOG
# Version bumps based on highest severity (minor if any feature)
git commit -am "Release v0.2.0"
pnpm release
```

## Best Practices

### ✅ Do:
- Create a changeset for **every PR** that affects published packages
- Write clear, user-facing summaries (they go in CHANGELOG)
- Use semantic versioning correctly:
  - **patch**: Bug fixes, no API changes
  - **minor**: New features, backward compatible
  - **major**: Breaking changes
- Commit changesets with your code changes
- Group related changes in one changeset when appropriate

### ❌ Don't:
- Don't manually edit `package.json` versions
- Don't create changesets for internal/dev-only changes
- Don't forget to run `pnpm version` before releasing
- Don't skip changesets thinking "I'll do it later"

## Manual Version Bump (Emergency)

If you need to manually bump versions without changesets:

```bash
# Bump all linked packages
pnpm -r --filter "@zebric/*" version 0.1.2
```

But **prefer using changesets** for consistency!

## CI/CD Integration

For automated releases in GitHub Actions:

```yaml
name: Release

on:
  push:
    branches:
      - main

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install
      - run: pnpm build
      - run: pnpm test

      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

This will:
1. Create a "Version Packages" PR with all pending changesets
2. When you merge that PR, it automatically publishes to npm

## Troubleshooting

### "No changesets found"

You haven't created any changesets yet. Run `pnpm changeset` first.

### "Package not found on npm"

Make sure `publishConfig.access: "public"` is set in package.json for scoped packages.

### Versions out of sync

If packages get out of sync, you can reset them:

```bash
# Manually set all to same version
pnpm -r --filter "@zebric/*" version 0.1.1
```

## Learn More

- [Changesets Documentation](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
- [pnpm Workspaces](https://pnpm.io/workspaces)

---

**Summary**: Instead of manually editing versions, just run `pnpm changeset` after each change, then `pnpm version` when ready to release. Changesets handles everything else!
