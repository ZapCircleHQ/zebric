# Task Tracker Example

A task management application demonstrating the Zebric Framework's **behavior-driven UI** capabilities.

## Features

- **Kanban Board**: Custom dashboard with three columns (Urgent, In Progress, Backlog)
- **Custom Rendering**: JavaScript behaviors for full control over UI
- **Intent Preservation**: Natural language requirements stored alongside generated code
- **Status Cycling**: Click task indicators to cycle through states
- **Standard Forms**: CRUD operations using Blueprint's built-in forms

## Architecture

This example showcases the **behavior bridge** - connecting natural language intent to runtime execution:

1. **Intent (English)**: Stored in `blueprint.toml` under `[page."/".behavior].intent`
2. **Implementation (JavaScript)**: Separate files in `behaviors/` directory
3. **Execution**: BehaviorExecutor runs JavaScript in sandboxed context
4. **Rendering**: Returns full HTML (no framework lock-in)

## Files

```
task-tracker/
├── blueprint.toml              # Blueprint configuration
└── behaviors/
    ├── dashboard-render.js     # Kanban board render function
    └── status-click.js         # Status update handler
```

## Running

From the `zebric` root directory:

```bash
# Build the runtime
pnpm --filter @zebric/runtime build

# Run the CLI dev server
pnpm --filter @zebric/cli dev examples/task-tracker/blueprint.toml
```

Visit http://localhost:3000 to see the task dashboard.

## How It Works

### Dashboard Rendering

The dashboard page specifies a custom `render` behavior:

```toml
[page."/"]
title = "Task Dashboard"

[page."/".behavior]
intent = """
The home screen should show all tasks past due or due today in the left column,
all tasks in progress in the middle column, and all remaining tasks in the right column.
...
"""
render = "./behaviors/dashboard-render.js"
```

The `dashboard-render.js` file exports a function:

```javascript
function render(ctx) {
  const { data, helpers } = ctx

  // Query data
  const urgent = data.Task.where(t => ...)
  const inProgress = data.Task.where(t => ...)
  const backlog = data.Task.where(t => ...)

  // Return full HTML
  return `<!DOCTYPE html>...`
}

render  // Export via last statement
```

### Status Cycling

Click handlers call API endpoints that trigger behavior handlers:

```javascript
// In dashboard HTML
<button onclick="handleStatusClick('${task.id}', '${task.status}')">
  ${getStatusIcon(task.status)}
</button>

<script>
  async function handleStatusClick(taskId, currentStatus) {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus })
    })
    window.location.reload()
  }
</script>
```

## Key Concepts

### Intent Preservation

The original natural language requirement is stored in the Blueprint:

```toml
[page."/".behavior]
intent = """
The home screen should show all tasks past due or due today...
"""
```

This allows:
- **Regeneration**: AI can update implementation while preserving intent
- **Documentation**: Human-readable description of page behavior
- **Evolution**: Easy to modify intent and regenerate code

### Behavior Context

Behaviors receive a controlled context:

```javascript
{
  data: {
    Task: {
      where: (fn) => [...],
      orderBy: (field, order) => [...],
      // ... query methods
    }
  },
  helpers: {
    today: () => '2025-10-10',
    formatDate: (date) => 'Oct 10, 2025',
    escapeHtml: (str) => '&lt;script&gt;',
    // ... utility functions
  },
  params: { id: '...' },
  session: { user: { ... } }
}
```

### Sandboxing

Behaviors run in VM sandbox (similar to limited plugins):
- ✅ No filesystem access
- ✅ No network access
- ✅ No environment variables
- ✅ 5 second timeout
- ✅ Only provided APIs available

### Hot Reload

Changes to behavior files reload instantly during development:

```bash
# Edit behaviors/dashboard-render.js
# Save file
# Refresh browser - changes appear immediately
```

## Comparison to Standard Pages

| Feature | Standard Page | Behavior-Driven Page |
|---------|--------------|---------------------|
| Definition | Blueprint TOML | Blueprint + JavaScript |
| Rendering | Built-in layouts | Custom HTML |
| Flexibility | Limited | Full control |
| Learning Curve | Low | Medium |
| Use Case | CRUD screens | Enhanced UX |

## When to Use Behaviors

**Use standard pages when:**
- Simple CRUD operations
- List/detail/form layouts sufficient
- Rapid prototyping

**Use behaviors when:**
- Custom layouts (kanban, calendar, dashboard)
- Complex interactions
- Unique UX requirements
- Integration with existing HTML/CSS

## Next Steps

1. **Add more behaviors**: Try creating a calendar view or chart
2. **Modify intent**: Update the natural language description
3. **Regenerate code**: Use AI to implement updated intent
4. **Mix approaches**: Some pages standard, some custom
