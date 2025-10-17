# Card Grid Layout Plugin

A layout renderer plugin for Zebric Engine that displays list pages as responsive card grids instead of tables.

## Features

- ✅ Responsive grid layout (1/2/3 columns on mobile/tablet/desktop)
- ✅ Hover effects and transitions
- ✅ Automatic field detection and formatting
- ✅ Click-to-view navigation
- ✅ Perfect for image-heavy content, product catalogs, portfolios

## Installation

### From Local Path
```json
{
  "plugins": [
    {
      "name": "./plugins/card-grid-layout"
    }
  ]
}
```

### From NPM (when published)
```bash
pnpm add @zebric-plugin/card-grid-layout
```

```json
{
  "plugins": [
    {
      "name": "@zebric-plugin/card-grid-layout"
    }
  ]
}
```

## Usage

In your Blueprint, set the layout to `card-grid`:

```json
{
  "pages": [
    {
      "path": "/products",
      "title": "Products",
      "layout": "card-grid",
      "queries": {
        "products": { "entity": "Product" }
      }
    }
  ]
}
```

## How It Works

The plugin:
1. Detects the first 3 display fields (excluding system fields like id, createdAt)
2. Renders title/name fields as card headers
3. Renders body/description fields as truncated text (150 chars)
4. Renders other fields as metadata
5. Adds a "View Details" link to the detail page

## Field Formatting

- `title` or `name` → Card header (h3)
- `body` or `description` → Truncated paragraph (150 chars)
- Other fields → Small gray text

## Example Output

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <div class="card hover:shadow-lg transition-shadow">
    <div class="p-6">
      <h3>Product Title</h3>
      <p>Product description truncated to 150 characters...</p>
      <div class="text-sm">$99.99</div>
    </div>
    <div class="px-6 py-4 bg-gray-50">
      <a href="/products/123">View Details →</a>
    </div>
  </div>
</div>
```

## Development

```bash
# Build plugin
pnpm build

# Watch mode
pnpm dev
```

## License

MIT
