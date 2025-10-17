/**
 * Status Click Behavior
 *
 * Handles status indicator clicks to cycle through task states:
 * not_started → in_progress → done → not_started (cycle)
 */

async function onClick(ctx) {
  const { params, data, helpers } = ctx
  const taskId = params.taskId
  const currentStatus = params.currentStatus

  // Define status cycle
  const states = ['not_started', 'in_progress', 'done']
  const currentIndex = states.indexOf(currentStatus)
  const nextIndex = (currentIndex + 1) % states.length
  const nextStatus = states[nextIndex]

  // Update the task
  await data.Task.update(taskId, {
    status: nextStatus,
    updatedAt: helpers.now()
  })

  return {
    success: true,
    newStatus: nextStatus
  }
}

// Export the function
onClick
