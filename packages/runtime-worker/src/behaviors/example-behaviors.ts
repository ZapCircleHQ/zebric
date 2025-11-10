/**
 * Example Behaviors for CloudFlare Workers
 *
 * These are example behavior functions that can be bundled with your Worker.
 * Import and register them in your worker's entry point.
 */

import type { BehaviorContext } from './behavior-registry.js'

/**
 * Example: Render a list of tasks
 *
 * Usage in Blueprint:
 *   [page."/tasks".behavior]
 *   render = "behaviors/render-tasks"
 */
export function renderTasks(context: BehaviorContext): string {
  const { data, helpers } = context
  const tasks = data.tasks || []

  return `
    <div class="tasks-container">
      <h1>My Tasks</h1>
      <div class="task-list">
        ${tasks.map((task: any) => `
          <div class="task task-${task.status}">
            <div class="task-header">
              <h3>${helpers.escapeHtml(task.title)}</h3>
              <span class="badge badge-${task.priority}">${task.priority}</span>
            </div>
            <p class="task-description">${helpers.escapeHtml(task.description || '')}</p>
            <div class="task-meta">
              <span class="due-date">Due: ${helpers.formatDate(task.dueDate)}</span>
              <span class="status">${task.status}</span>
            </div>
          </div>
        `).join('')}
      </div>
      ${tasks.length === 0 ? '<p class="empty-state">No tasks found</p>' : ''}
    </div>
  `
}

/**
 * Example: Handle status change click
 *
 * Usage in Blueprint:
 *   [page."/tasks/:id".behavior]
 *   on_status_click = "behaviors/on-status-click"
 */
export async function onStatusClick(context: BehaviorContext): Promise<any> {
  const { params, session } = context
  const taskId = params?.id

  if (!taskId) {
    return { error: 'Task ID required' }
  }

  if (!session) {
    return { error: 'Authentication required' }
  }

  // Return data that will be passed to the query executor
  // The runtime will handle the actual database update
  return {
    action: 'update',
    entity: 'Task',
    id: taskId,
    data: {
      status: 'completed',
      completedAt: new Date().toISOString(),
      completedBy: session.userId
    }
  }
}

/**
 * Example: Render a dashboard with statistics
 *
 * Usage in Blueprint:
 *   [page."/dashboard".behavior]
 *   render = "behaviors/render-dashboard"
 */
export function renderDashboard(context: BehaviorContext): string {
  const { data, helpers, session } = context

  const stats = {
    totalTasks: data.tasks?.length || 0,
    completedTasks: data.tasks?.filter((t: any) => t.status === 'completed').length || 0,
    pendingTasks: data.tasks?.filter((t: any) => t.status === 'pending').length || 0,
    overdueTasks: data.tasks?.filter((t: any) => {
      return t.status !== 'completed' && new Date(t.dueDate) < new Date()
    }).length || 0
  }

  const completionRate = stats.totalTasks > 0
    ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
    : 0

  return `
    <div class="dashboard">
      <h1>Welcome, ${session?.user?.name || 'Guest'}!</h1>

      <div class="stats-grid">
        <div class="stat-card">
          <h3>Total Tasks</h3>
          <p class="stat-number">${stats.totalTasks}</p>
        </div>

        <div class="stat-card stat-completed">
          <h3>Completed</h3>
          <p class="stat-number">${stats.completedTasks}</p>
        </div>

        <div class="stat-card stat-pending">
          <h3>Pending</h3>
          <p class="stat-number">${stats.pendingTasks}</p>
        </div>

        <div class="stat-card stat-overdue">
          <h3>Overdue</h3>
          <p class="stat-number">${stats.overdueTasks}</p>
        </div>
      </div>

      <div class="progress-card">
        <h2>Completion Rate</h2>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${completionRate}%"></div>
        </div>
        <p class="progress-text">${completionRate}% complete</p>
      </div>

      <div class="recent-tasks">
        <h2>Recent Tasks</h2>
        ${data.tasks?.slice(0, 5).map((task: any) => `
          <div class="task-item">
            <span class="task-title">${helpers.escapeHtml(task.title)}</span>
            <span class="task-date">${helpers.formatDate(task.createdAt)}</span>
          </div>
        `).join('') || '<p>No recent tasks</p>'}
      </div>
    </div>
  `
}

/**
 * Example: Complex data transformation
 *
 * Usage in Blueprint:
 *   [page."/reports".behavior]
 *   render = "behaviors/render-report"
 */
export function renderReport(context: BehaviorContext): string {
  const { data, helpers } = context
  const tasks = data.tasks || []

  // Group tasks by status
  const grouped = tasks.reduce((acc: any, task: any) => {
    const status = task.status || 'unknown'
    if (!acc[status]) {
      acc[status] = []
    }
    acc[status].push(task)
    return acc
  }, {})

  // Calculate statistics by priority
  const byPriority = tasks.reduce((acc: any, task: any) => {
    const priority = task.priority || 'normal'
    acc[priority] = (acc[priority] || 0) + 1
    return acc
  }, {})

  return `
    <div class="report">
      <h1>Task Report</h1>
      <p>Generated: ${helpers.formatDateTime(helpers.now())}</p>

      <section class="report-section">
        <h2>Tasks by Status</h2>
        <table class="report-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Count</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(grouped).map(([status, items]: [string, any]) => {
              const count = items.length
              const percentage = Math.round((count / tasks.length) * 100)
              return `
                <tr>
                  <td>${status}</td>
                  <td>${count}</td>
                  <td>${percentage}%</td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </section>

      <section class="report-section">
        <h2>Tasks by Priority</h2>
        <div class="priority-chart">
          ${Object.entries(byPriority).map(([priority, count]) => `
            <div class="priority-bar priority-${priority}">
              <span class="priority-label">${priority}</span>
              <div class="bar" style="width: ${(Number(count) / tasks.length) * 100}%"></div>
              <span class="priority-count">${count}</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `
}
