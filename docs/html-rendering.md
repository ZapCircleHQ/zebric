# HTML Rendering

The Zebric Engine includes a built-in server-side HTML renderer that generates complete HTML pages from Blueprint definitions.

## Overview

- **Server-Side Rendering**: HTML generated on the server at runtime
- **No Build Step**: Uses Tailwind CSS CDN for styling
- **Layout System**: Built-in layouts for common patterns
- **Theme Support**: Customizable themes with Tailwind classes
- **View Transitions**: Modern browser navigation animations
- **Progressive Enhancement**: Optional JavaScript enhancements

## Features

✅ **List/Table Layout** - Data tables with pagination
✅ **Detail Layout** - Single record display with related data
✅ **Form Layout** - All form input types with validation
✅ **Dashboard Layout** - Multi-widget dashboard with stats
✅ **Custom Layouts** - Extensible for custom needs
✅ **Responsive Design** - Mobile-first Tailwind CSS
✅ **Error States** - Beautiful 404, empty states, errors
✅ **Navigation** - Auto-generated from pages
✅ **Client Enhancement** - Optional JavaScript for AJAX forms

## Layouts

### List Layout

Displays collections of data as tables with actions.

**Blueprint:**
```json
{
  "path": "/posts",
  "title": "All Posts",
  "layout": "list",
  "queries": {
    "posts": {
      "entity": "Post",
      "where": { "status": "published" },
      "orderBy": { "createdAt": "desc" },
      "limit": 20
    }
  }
}
```

**Rendered Features:**
- Page header with "New" button
- Responsive data table
- Auto-generated columns from entity fields
- View/Edit actions per row
- Empty state if no data
- Pagination (coming soon)

**HTML Structure:**
```html
<div class="container">
  <div class="page-header">
    <h1>All Posts</h1>
    <a href="/posts/new">New Post</a>
  </div>

  <div class="card">
    <table class="table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Created At</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>My First Post</td>
          <td>published</td>
          <td>Oct 4, 2025</td>
          <td>
            <a href="/posts/123">View</a>
            <a href="/posts/123/edit">Edit</a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

### Detail Layout

Displays a single record with all fields and related data.

**Blueprint:**
```json
{
  "path": "/posts/:id",
  "title": "Post Detail",
  "layout": "detail",
  "queries": {
    "post": {
      "entity": "Post",
      "where": { "id": "$params.id" }
    },
    "comments": {
      "entity": "Comment",
      "where": { "postId": "$params.id" }
    }
  }
}
```

**Rendered Features:**
- Card with all record fields
- Formatted field values (dates, booleans, etc.)
- Edit and Delete actions
- Related data sections (e.g., comments)
- Related data shown as tables

**HTML Structure:**
```html
<div class="container max-w-2xl">
  <div class="card">
    <div class="p-6">
      <h1>Post Detail</h1>

      <dl class="space-y-4">
        <div>
          <dt>Title</dt>
          <dd>My First Post</dd>
        </div>
        <div>
          <dt>Body</dt>
          <dd>Post content here...</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>published</dd>
        </div>
      </dl>

      <div class="mt-6 flex gap-3">
        <a href="/posts/123/edit">Edit</a>
        <button onclick="...">Delete</button>
      </div>
    </div>
  </div>

  <!-- Related data -->
  <div class="mt-8">
    <h2>Comments</h2>
    <table>...</table>
  </div>
</div>
```

### Form Layout

Generates complete forms with all field types and validation.

**Blueprint:**
```json
{
  "path": "/posts/new",
  "title": "Create Post",
  "layout": "form",
  "form": {
    "entity": "Post",
    "method": "create",
    "fields": [
      {
        "name": "title",
        "type": "text",
        "label": "Title",
        "required": true
      },
      {
        "name": "slug",
        "type": "text",
        "label": "URL Slug",
        "required": true,
        "pattern": "^[a-z0-9-]+$",
        "error_message": "Slug must be lowercase letters, numbers, and hyphens"
      },
      {
        "name": "body",
        "type": "textarea",
        "label": "Content",
        "rows": 10,
        "required": true
      },
      {
        "name": "status",
        "type": "select",
        "label": "Status",
        "options": ["draft", "published"],
        "default": "draft"
      }
    ],
    "onSuccess": {
      "redirect": "/posts/{id}",
      "message": "Post created successfully!"
    }
  }
}
```

**Supported Field Types:**
- `text` - Text input
- `email` - Email input with validation
- `password` - Password input
- `number` - Number input with min/max
- `textarea` - Multi-line text with rows
- `select` - Dropdown with options
- `checkbox` - Single checkbox
- `radio` - Radio buttons
- `file` - File upload with accept types
- `date` - Date picker
- `datetime` - Date and time picker

**Validation:**
- `required` - Field is required
- `pattern` - Regex validation
- `min` / `max` - Number bounds
- `minLength` / `maxLength` - String length
- `error_message` - Custom error message

**HTML Structure:**
```html
<div class="container max-w-2xl">
  <h1>Create Post</h1>

  <form method="POST" action="/posts/new" class="form">
    <div class="form-field">
      <label for="title">
        Title <span class="text-red-500">*</span>
      </label>
      <input
        type="text"
        id="title"
        name="title"
        required
        class="input"
      />
    </div>

    <div class="form-field">
      <label for="body">Content</label>
      <textarea
        id="body"
        name="body"
        rows="10"
        class="textarea"
      ></textarea>
    </div>

    <div class="form-actions">
      <button type="button" onclick="history.back()">
        Cancel
      </button>
      <button type="submit">
        Create
      </button>
    </div>
  </form>
</div>
```

### Dashboard Layout

Multi-widget dashboard with statistics and recent items.

**Blueprint:**
```json
{
  "path": "/dashboard",
  "title": "Dashboard",
  "layout": "dashboard",
  "auth": "required",
  "queries": {
    "totalPosts": {
      "entity": "Post",
      "limit": 5
    },
    "draftPosts": {
      "entity": "Post",
      "where": { "status": "draft" },
      "limit": 5
    },
    "publishedPosts": {
      "entity": "Post",
      "where": { "status": "published" },
      "limit": 5
    },
    "recentUsers": {
      "entity": "User",
      "orderBy": { "createdAt": "desc" },
      "limit": 5
    }
  }
}
```

**Rendered Features:**
- Grid layout (responsive: 1/2/3 columns)
- Stat cards with counts
- Recent items lists
- "View all" links
- Auto-generated from queries

**HTML Structure:**
```html
<div class="container">
  <h1>Dashboard</h1>

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    <!-- Widget 1 -->
    <div class="card">
      <div class="p-6">
        <h3>Total Posts</h3>
        <p class="text-3xl font-bold">42</p>

        <ul class="mt-4 space-y-2">
          <li><a href="/posts/1">First Post</a></li>
          <li><a href="/posts/2">Second Post</a></li>
        </ul>

        <a href="/posts">View all →</a>
      </div>
    </div>

    <!-- Widget 2 -->
    <div class="card">
      <div class="p-6">
        <h3>Draft Posts</h3>
        <p class="text-3xl font-bold">5</p>
        ...
      </div>
    </div>
  </div>
</div>
```

## Theme System

### Default Theme

The engine includes a default light theme using Tailwind CSS:

```typescript
{
  // Layout
  body: 'bg-gray-50 text-gray-900 min-h-screen',
  container: 'container mx-auto px-4 py-8',

  // Typography
  heading1: 'text-3xl font-bold text-gray-900 mb-6',
  heading2: 'text-2xl font-semibold text-gray-800 mb-4',

  // Components
  card: 'bg-white rounded-lg shadow-sm border border-gray-200',
  buttonPrimary: 'px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700',

  // Forms
  input: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500',

  // Tables
  table: 'min-w-full divide-y divide-gray-200',
  tableHeader: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase',
}
```

### Dark Theme

A dark theme is also included:

```typescript
{
  body: 'bg-gray-900 text-gray-100',
  card: 'bg-gray-800 border-gray-700',
  input: 'bg-gray-700 border-gray-600 text-gray-100',
  // ...
}
```

### Custom Themes

Create custom themes by implementing the `Theme` interface:

```typescript
import { Theme } from '@zebric/runtime'

export const myTheme: Theme = {
  name: 'my-theme',
  body: 'bg-purple-50 text-purple-900',
  // ... customize all theme properties
}
```

## Progressive Enhancement

The renderer includes optional JavaScript for enhanced UX.

### AJAX Form Submission

Forms can submit via AJAX instead of full page reload:

```json
{
  "ui": {
    "progressive_enhancement": "none" | "alpine" | "htmx"
  }
}
```

**Features:**
- AJAX form submission
- Inline error display
- Loading states on buttons
- Automatic redirect on success
- No page reload needed

**Client Script:**
```javascript
document.querySelectorAll('form[data-enhance]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault()

    // Show loading state
    submitBtn.textContent = 'Saving...'
    submitBtn.disabled = true

    // Submit via fetch
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })

    const result = await response.json()

    if (result.redirect) {
      window.location.href = result.redirect
    } else if (result.errors) {
      // Show inline errors
      result.errors.forEach(err => {
        const errorEl = document.querySelector(`[data-error="${err.field}"]`)
        errorEl.textContent = err.message
      })
    }
  })
})
```

## View Transitions

Modern browsers support view transitions for smooth navigation:

```json
{
  "ui": {
    "view_transitions": true
  }
}
```

**Generated HTML:**
```html
<meta name="view-transition" content="same-origin">
<style>
  @view-transition {
    navigation: auto;
  }

  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation-duration: 0.2s;
  }
</style>
```

## Content Negotiation

The renderer automatically detects if the client wants JSON or HTML:

**JSON Response** (when `Accept: application/json`):
```json
{
  "page": "/posts",
  "title": "All Posts",
  "layout": "list",
  "data": {
    "posts": [...]
  }
}
```

**HTML Response** (default):
```html
<!DOCTYPE html>
<html>
  <head>...</head>
  <body>
    <nav>...</nav>
    <main>...</main>
  </body>
</html>
```

**Testing:**
```bash
# Get HTML
curl http://localhost:3000/posts

# Get JSON
curl -H "Accept: application/json" http://localhost:3000/posts
```

## Error States

Beautiful error pages for common scenarios:

### 404 Not Found
```html
<div class="container">
  <div class="error-state">
    <p>Record not found</p>
  </div>
</div>
```

### Empty State
```html
<div class="card">
  <div class="empty-state">
    <p>No posts found</p>
    <a href="/posts/new" class="button-primary">
      Create first post
    </a>
  </div>
</div>
```

### Validation Errors
```html
<div class="form-field">
  <label>Email</label>
  <input type="email" name="email" />
  <p class="field-error">
    Please enter a valid email address
  </p>
</div>
```

## Accessibility Features

The HTML renderer includes WCAG 2.1 Level AA accessibility features for keyboard navigation and screen reader support.

### Skip Navigation
Allows keyboard users to skip directly to main content:

```html
<!-- Skip link (visible on focus) -->
<a href="#main-content" class="sr-only focus:not-sr-only">
  Skip to main content
</a>

<!-- Main content landmark -->
<main id="main-content" role="main">
  <!-- Page content -->
</main>
```

### Navigation ARIA

```html
<nav aria-label="Primary navigation">
  <a href="/" aria-label="Home">App Name</a>
  <a href="/posts" aria-current="page">Posts</a>
  <a href="/about">About</a>
</nav>
```

- **aria-label** - Describes navigation purpose
- **aria-current="page"** - Indicates active page

### Table Accessibility

```html
<table>
  <caption class="sr-only">Posts list</caption>
  <thead>
    <tr>
      <th scope="col">Title</th>
      <th scope="col">Author</th>
      <th scope="col">Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>My Post</td>
      <td>John Doe</td>
      <td>
        <a href="/posts/1" aria-label="View My Post">View</a>
        <a href="/posts/1/edit" aria-label="Edit My Post">Edit</a>
      </td>
    </tr>
  </tbody>
</table>
```

- **caption** - Describes table purpose (hidden visually with `sr-only`)
- **scope="col"** - Identifies column headers
- **Contextual aria-labels** - Action links include item context

### Form Accessibility

```html
<div class="form-field">
  <label for="email">
    Email
    <span aria-label="required">*</span>
  </label>
  <input
    id="email"
    name="email"
    type="email"
    required
    autocomplete="email"
    aria-describedby="email-error"
    aria-invalid="true"
  />
  <p id="email-error" role="alert">
    Please enter a valid email address
  </p>
</div>
```

- **aria-describedby** - Links input to error message
- **aria-invalid** - Indicates validation state
- **autocomplete** - Helps browsers autofill (30+ field types supported)
- **role="alert"** - Announces errors to screen readers

### Screen Reader Only Content

The `sr-only` utility class hides content visually but keeps it accessible:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* Show when focused (for skip links) */
.sr-only:focus {
  position: static;
  width: auto;
  height: auto;
  /* ...restored styles */
}
```

### Keyboard Navigation

All interactive elements are keyboard accessible:

- **Tab** - Move between elements
- **Enter/Space** - Activate buttons/links
- **Escape** - Close modals (when implemented)
- **Arrow keys** - Navigate menus (when implemented)

Enhanced focus indicators show keyboard position:

```css
.keyboard-nav *:focus {
  outline: 2px solid #4F46E5;
  outline-offset: 2px;
}
```

### Testing Accessibility

1. **Keyboard Navigation**: Tab through the page, ensure all interactive elements are reachable
2. **Screen Reader**: Test with VoiceOver (Mac), NVDA (Windows), or JAWS
3. **Color Contrast**: Ensure 4.5:1 ratio for text (use browser devtools)
4. **Zoom**: Test at 200% zoom level
5. **Automated Tools**: Run Lighthouse or axe DevTools

---

## Next Steps

- Pagination for list views
- Search and filtering
- File upload handling
- Custom layout templates
- Theme customization UI
- Alpine.js / HTMX integration
