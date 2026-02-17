export interface StoryDefinition {
  id: string
  title: string
  blueprintPath: string
  description: string
  tests: string[]
}

export const stories: StoryDefinition[] = [
  {
    id: 'developer-onboarding',
    title: 'People Ops can onboard a developer',
    blueprintPath: 'examples/onboarding/blueprint.toml',
    description: 'Covers the end-to-end onboarding dashboard, action bar, and workflow wiring shown in docs/sample-blueprint-dev-onboarding.',
    tests: ['src/stories/developer-onboarding.story.test.ts']
  },
  {
    id: 'feature-pipeline',
    title: 'Product teams shepherd a feature request',
    blueprintPath: 'examples/vibe/blueprint.toml',
    description: 'Validates the multi-entity flow used for customer-to-delivery pipelines.',
    tests: ['src/stories/feature-pipeline.story.test.ts']
  },
  {
    id: 'task-tracker-kanban',
    title: 'Internal teams manage tasks via custom kanban board',
    blueprintPath: 'examples/task-tracker/blueprint.toml',
    description: 'Ensures the dashboard behavior, status transitions, and form success paths for the kanban experience remain intact.',
    tests: ['src/stories/task-tracker.story.test.ts']
  },
  {
    id: 'blog-publishing',
    title: 'Content team publishes blog posts with access control',
    blueprintPath: 'examples/blog/blueprint.toml',
    description: 'Verifies author relations, slug validation, and published-only visibility for the blog starter blueprint.',
    tests: ['src/stories/blog.story.test.ts']
  },
  {
    id: 'zebric-dispatch',
    title: 'Teams triage issues through the Dispatch workflow',
    blueprintPath: 'examples/zebric-dispatch/blueprint.toml',
    description: 'Validates dashboard/list/detail/form routing, intake form option labels, action-bar workflows for issue lifecycle, and Slack notification wiring.',
    tests: ['src/stories/zebric-dispatch.story.test.ts']
  }
]

export function getStory(id: string): StoryDefinition {
  const story = stories.find(story => story.id === id)
  if (!story) {
    throw new Error(`Story not found: ${id}`)
  }
  return story
}
