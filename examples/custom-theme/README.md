# Custom Theme Example

This example demonstrates how to create and use a custom theme with Zebric.

## Features

- **Custom Brand Theme**: Purple/pink gradient theme with modern styling
- **All Layouts**: Demonstrates theme applied to list, detail, form, and dashboard layouts
- **Hot Reload**: Changes to the theme file trigger automatic reloads
- **Type Safety**: Full TypeScript support for theme customization

## Theme Customization

The custom theme (`brand-theme.ts`) shows how to:

1. Override all theme properties
2. Use gradient backgrounds and modern effects
3. Add custom CSS animations
4. Create a cohesive brand experience

## Running the Example

```bash
# Install dependencies (from project root)
pnpm install

# Build the runtime package
pnpm --filter @zbl/runtime build

# Start the server
pnpm --filter custom-theme-example dev
```

Visit http://localhost:3000 to see the custom theme in action!

## Project Structure

```
custom-theme/
├── brand-theme.ts      # Custom theme definition
├── blueprint.json      # Blueprint configuration
├── server.ts           # Server entry point
└── README.md           # This file
```

## Key Code

### Defining a Custom Theme

```typescript
// brand-theme.ts
import type { Theme } from '@zebric/runtime'

export const brandTheme: Theme = {
  name: 'brand',
  body: 'bg-gradient-to-br from-purple-50 to-pink-50',
  buttonPrimary: 'px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 ...',
  // ... all other properties
}
```

### Using the Theme

```typescript
// server.ts
import { ZebricEngine } from '@zebric/runtime'
import { brandTheme } from './brand-theme.js'

const engine = new ZebricEngine({
  blueprintPath: './blueprint.json',
  theme: brandTheme  // ← Pass custom theme
})

await engine.start()
```

## Next Steps

- Try modifying the theme colors in `brand-theme.ts`
- Create a dark mode variant
- Add more custom CSS animations
- Build a theme switcher UI

See the [Themes and Layouts Documentation](../../docs/THEMES-AND-LAYOUTS.md) for more details.
