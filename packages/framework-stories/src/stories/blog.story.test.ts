import { beforeAll, describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { getStory } from './story-registry.js'
import { loadBlueprint } from '../utils/load-blueprint.js'

describe('Story: blog-publishing', () => {
  const story = getStory('blog-publishing')
  let blueprint: Blueprint

  beforeAll(async () => {
    blueprint = await loadBlueprint(story.blueprintPath)
  })

  it('models Post and User entities with proper relations', () => {
    const post = blueprint.entities?.find((entity) => entity.name === 'Post')
    const user = blueprint.entities?.find((entity) => entity.name === 'User')
    expect(post).toBeDefined()
    expect(user).toBeDefined()
    const authorRef = post?.fields.find((field: any) => field.name === 'authorId')
    expect(authorRef?.ref).toBe('User.id')
    expect(user?.relations?.posts?.entity).toBe('Post')
  })

  it('restricts post visibility to published content or the author', () => {
    const access = blueprint.entities?.find((entity) => entity.name === 'Post')?.access
    expect(access?.read).toBeDefined()
    expect(JSON.stringify(access?.read)).toContain('published')
  })

  it('enforces slug validation in the create form', () => {
    const newPostPage = blueprint.pages.find((page) => page.path === '/posts/new')
    const slugField = newPostPage?.form?.fields.find((field: any) => field.name === 'slug')
    expect(slugField?.pattern).toBe('^[a-z0-9-]+$')
    expect(slugField?.error_message).toContain('lowercase')
  })
})
