/**
 * Dashboard Render Behavior
 *
 * Renders a kanban-style task board with three columns:
 * - Urgent: Tasks past due or due today
 * - In Progress: Tasks currently being worked on
 * - Backlog: Tasks not yet started
 */

function render(ctx) {
  const { data, helpers } = ctx
  const today = helpers.today()

  // Get all tasks from query
  const allTasks = data.tasks || []

  // Filter tasks for each column
  const urgent = allTasks
    .filter(t =>
      (t.dueDate && (t.dueDate <= today)) &&
      t.status !== 'done'
    )
    .sort((a, b) => a.dueDate < b.dueDate ? -1 : 1)

  const inProgress = allTasks
    .filter(t => t.status === 'in_progress')
    .sort((a, b) => a.updatedAt > b.updatedAt ? -1 : 1)

  const backlog = allTasks
    .filter(t => t.status === 'not_started')
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        const priorityOrder = { high: 0, normal: 1, low: 2 }
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      }
      return a.createdAt > b.createdAt ? -1 : 1
    })

  // Build HTML
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Task Dashboard</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        .task-card {
          transition: all 0.2s;
        }
        .task-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .status-indicator {
          cursor: pointer;
          transition: transform 0.2s;
        }
        .status-indicator:hover {
          transform: scale(1.2);
        }
      </style>
    </head>
    <body class="bg-gray-100 min-h-screen">
      <div class="container mx-auto p-6">
        <!-- Header -->
        <div class="mb-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Task Dashboard</h1>
          <div class="flex justify-between items-center">
            <p class="text-gray-600">
              ${urgent.length} urgent • ${inProgress.length} in progress • ${backlog.length} in backlog
            </p>
            <a
              href="/tasks/new"
              class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              + New Task
            </a>
          </div>
        </div>

        <!-- Kanban Board -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Urgent Column -->
          <div class="bg-white rounded-lg shadow-sm p-4">
            <h2 class="text-xl font-semibold mb-4 text-red-700 flex items-center">
              🚨 Urgent
              <span class="ml-2 text-sm font-normal text-gray-500">(${urgent.length})</span>
            </h2>
            <div class="space-y-3">
              ${renderTasks(urgent, {
                color: '#1e3a8a',
                fontStyle: 'italic',
                bgColor: 'bg-red-50',
                borderColor: 'border-red-200'
              })}
            </div>
          </div>

          <!-- In Progress Column -->
          <div class="bg-white rounded-lg shadow-sm p-4">
            <h2 class="text-xl font-semibold mb-4 text-blue-700 flex items-center">
              🔨 In Progress
              <span class="ml-2 text-sm font-normal text-gray-500">(${inProgress.length})</span>
            </h2>
            <div class="space-y-3">
              ${renderTasks(inProgress, {
                color: '#2563eb',
                fontWeight: 'bold',
                bgColor: 'bg-blue-50',
                borderColor: 'border-blue-200'
              })}
            </div>
          </div>

          <!-- Backlog Column -->
          <div class="bg-white rounded-lg shadow-sm p-4">
            <h2 class="text-xl font-semibold mb-4 text-gray-700 flex items-center">
              📋 Backlog
              <span class="ml-2 text-sm font-normal text-gray-500">(${backlog.length})</span>
            </h2>
            <div class="space-y-3">
              ${renderTasks(backlog, {
                color: '#93c5fd',
                fontWeight: 'normal',
                bgColor: 'bg-gray-50',
                borderColor: 'border-gray-200'
              })}
            </div>
          </div>
        </div>
      </div>

      <!-- JavaScript for status clicking -->
      <script>
        async function handleStatusClick(taskId, currentStatus) {
          const states = ['not_started', 'in_progress', 'done']
          const currentIndex = states.indexOf(currentStatus)
          const nextIndex = (currentIndex + 1) % states.length
          const nextStatus = states[nextIndex]

          try {
            const response = await fetch(\`/api/tasks/\${taskId}\`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: nextStatus })
            })

            if (response.ok) {
              // Reload page to show updated state
              window.location.reload()
            }
          } catch (error) {
            console.error('Failed to update task:', error)
          }
        }
      </script>
    </body>
    </html>
  `

  // Helper function to render tasks
  function renderTasks(tasks, style) {
    if (tasks.length === 0) {
      return `
        <div class="text-gray-400 text-center py-8 italic">
          No tasks
        </div>
      `
    }

    return tasks.map(task => {
      const isOverdue = task.dueDate && task.dueDate < today
      const priorityColors = {
        high: 'text-red-600',
        normal: 'text-gray-600',
        low: 'text-gray-400'
      }

      return `
        <div
          class="task-card ${style.bgColor} border ${style.borderColor} rounded-lg p-3"
          style="color: ${style.color}; font-style: ${style.fontStyle || 'normal'}; font-weight: ${style.fontWeight || 'normal'}"
        >
          <div class="flex items-start">
            <!-- Status Indicator -->
            <button
              class="status-indicator mr-3 text-2xl"
              onclick="handleStatusClick('${task.id}', '${task.status}')"
              title="Click to cycle status"
            >
              ${getStatusIcon(task.status)}
            </button>

            <!-- Task Content -->
            <div class="flex-1">
              <div class="flex items-start justify-between">
                <a
                  href="/tasks/${task.id}"
                  class="font-medium hover:underline"
                >
                  ${helpers.escapeHtml(task.title)}
                </a>
                ${task.priority !== 'normal' ? `
                  <span class="ml-2 text-xs ${priorityColors[task.priority]}">
                    ${task.priority.toUpperCase()}
                  </span>
                ` : ''}
              </div>

              ${task.description ? `
                <p class="text-sm text-gray-600 mt-1 line-clamp-2">
                  ${helpers.escapeHtml(task.description)}
                </p>
              ` : ''}

              ${task.dueDate ? `
                <div class="text-xs mt-2 ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}">
                  ${isOverdue ? '⚠️ ' : '📅 '}Due: ${helpers.formatDate(task.dueDate)}
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `
    }).join('')
  }

  // Helper to get status icon
  function getStatusIcon(status) {
    const icons = {
      'not_started': '⭕',
      'in_progress': '🔵',
      'done': '✅'
    }
    return icons[status] || '⭕'
  }
}

// Export the function
render
