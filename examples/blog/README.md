# Blog Example

A simple blog application built with Zebric demonstrating core features.

## Features

- ✅ Public blog post listing and detail pages
- ✅ Create, edit, and delete posts (requires authentication)
- ✅ User profiles with post history
- ✅ Dashboard for content management
- ✅ Draft and published post statuses
- ✅ Server-side HTML rendering with Tailwind CSS
- ✅ Form validation and error handling
- ✅ Access control and permissions

## Getting Started

### 1. Build the Project

```bash
# From project root
pnpm build
```

### 2. Start the Dev Server

```bash
# From project root
node packages/cli/dist/index.js dev --blueprint examples/blog/blueprint.json --port 3000

# Or use the convenience script
pnpm --filter blog-example dev
```

The blog will be available at http://localhost:3000

## Pages

| Path | Description | Auth Required |
|------|-------------|---------------|
| `/` | Home - List of published posts | No |
| `/posts` | All published posts | No |
| `/posts/:id` | Post detail page | No |
| `/posts/new` | Create new post form | Optional* |
| `/posts/:id/edit` | Edit post form | Yes |
| `/posts/:id/delete` | Delete post confirmation | Yes |
| `/users/:id` | User profile page | No |
| `/dashboard` | Admin dashboard | Yes |

*The form is accessible to everyone, but creating posts requires authentication.

## Testing the Example

The example works and renders correctly! Here's what's been tested and verified:

✅ **Pages Load Correctly**
- Home page (`/`) renders with empty state when no posts exist
- Posts list (`/posts`) renders with proper HTML structure
- New post form (`/posts/new`) renders with all form fields and validation
- 404 error pages render beautifully
- Admin endpoints work (`/__admin/blueprint`, `/__admin/pages`, etc.)

✅ **Security Features**
- XSS protection with HTML escaping throughout
- CSP headers configured correctly
- Secure by default auth (pages require auth unless explicitly set to `none` or `optional`)
- Access control rules enforced

✅ **HTML Rendering**
- Server-side rendering with Tailwind CSS
- Responsive navigation with properly escaped links
- Form fields with client-side enhancement
- Error states and validation messages

## Known Limitations

1. **Authentication UI**: The example doesn't include sign-in/sign-up forms yet. You'll need to use Better Auth API endpoints directly or extend the example.

2. **API Access Control**: Direct API endpoints (`/api/posts`) enforce access rules but don't have session context in curl requests. Use the HTML forms for CRUD operations with auth.

3. **Initial Data**: Database starts empty. You'll need to create users and posts through forms or by extending the seed data.

## Architecture

- **Runtime**: Pure JSON interpreter, no build step
- **Database**: SQLite with Better-SQLite3
- **Auth**: Better Auth v5 with email provider + RBAC
- **Rendering**: Server-side HTML with Tailwind CSS CDN
- **Security**: Row-level access control, XSS protection, CSP headers

## Learn More

- [Zebric Documentation](../../docs/)
- [Blueprint Specification](../../ZBL-Engine-Specification.md)
- [Plugin System](../../packages/runtime/docs/PLUGIN-SYSTEM.md)
- [HTML Rendering](../../docs/HTML-RENDERING.md)
