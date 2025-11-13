# Renderer Templates

The built-in page layouts (list/detail/form/dashboard/auth views) are implemented as Liquid templates.
Editing workflow:

1. Update the `.liquid` files under `packages/runtime-core/src/renderer/layout-templates/` or `auth-templates/`.
2. Regenerate the compiled template maps:
   ```bash
   pnpm run build:templates
   ```
   This writes updated strings to `packages/runtime-core/src/renderer/generated/`.
3. Commit both the edited `.liquid` files **and** the regenerated `generated/*.ts` outputs.

A Husky `pre-commit` hook rebuilds these files automatically whenever staged `.liquid` templates change, so you normally just edit + stage the sources. If the hook runs, it re-adds the generated files.
