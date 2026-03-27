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
◉ @zebric/runtime-core
◉ @zebric/runtime-node
◉ @zebric/cli
◯ @zebric/observability
◯ @zebric/plugin-sdk

🦋  What kind of change is this for the selected packages?
◯ patch (bug fixes)
● minor (new features)
◯ major (breaking changes)

🦋  Please enter a summary for this change:
Added file upload support with local storage
```

### 2. Merge Changes Into `main`

Once a PR with a changeset is merged, the release workflow on `main` will:
1. Detect all pending changesets
2. Open or update a `Release packages` PR
3. Apply version bumps to all linked published packages
4. Update changelog entries from the changeset summaries

### 3. Review And Merge The Release PR

The `Release packages` PR is the human review point. Before merging it:
1. Confirm the version bump level is correct
2. Confirm the generated changelog text is clear and user-facing
3. Confirm CI is green on the release PR

When that PR is merged, the workflow will automatically:
1. Build the workspace
2. Publish packages to npm
3. Create GitHub releases for the published packages

## Configuration

Our setup (`.changeset/config.json`) uses **linked packages**, meaning all core packages version together:

```json
{
  "linked": [
    [
      "@zebric/runtime-core",
      "@zebric/runtime-hono",
      "@zebric/runtime-node",
      "@zebric/runtime-worker",
      "@zebric/cli",
      "@zebric/notifications",
      "@zebric/observability",
      "@zebric/plugin-sdk",
      "@zebric/themes"
    ]
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

# 4. Merge the PR to main
# Changesets will open/update the Release packages PR automatically

# 5. Review and merge the Release packages PR
# Publishing happens automatically after merge
```

### Scenario 2: New Feature (Minor Release)

```bash
# 1. Implement the feature

# 2. Create a changeset
pnpm changeset
# Select: minor
# Summary: "Added file upload support with S3 integration"

# 3. Merge the feature PR to main

# 4. Review and merge the Release packages PR
# Publishing happens automatically after merge
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

# Merge the feature PRs to main
# Changesets collects all pending entries into one Release packages PR
# Version bumps are based on the highest severity across the pending changesets
# Merge the Release packages PR to publish
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
- Review the generated `Release packages` PR instead of editing versions by hand

### ❌ Don't:
- Don't manually edit published package versions
- Don't create changesets for internal/dev-only changes
- Don't bypass the generated release PR for normal releases
- Don't skip changesets thinking "I'll do it later"

## Local Commands

Useful local commands while working with the automated flow:

```bash
# Add a new changeset
pnpm changeset

# Preview whether pending changesets exist
pnpm changeset status

# Verify all published package versions are aligned
pnpm release:check
```

## CI/CD Integration

The GitHub Actions release workflow runs on pushes to `main` and uses `changesets/action`:

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.30.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://registry.npmjs.org'
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          version: pnpm changeset version
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

This will:
1. Create a `Release packages` PR with all pending changesets
2. When you merge that PR, it automatically publishes to npm

## Troubleshooting

### "No changesets found"

There are no unreleased package changes queued. Run `pnpm changeset` in the PR that changes a published package.

### "Package not found on npm"

Make sure `publishConfig.access: "public"` is set in package.json for scoped packages.

### Versions out of sync

Run:

```bash
pnpm release:check
```

## Learn More

- [Changesets Documentation](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
- [pnpm Workspaces](https://pnpm.io/workspaces)

---

**Summary**: Add a changeset in each release-worthy PR, merge to `main`, review the generated `Release packages` PR, and let GitHub Actions publish after that PR is merged.
