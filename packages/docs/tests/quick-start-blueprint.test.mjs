import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { AccessControl } from '../../runtime-core/dist/database/access-control.js'
import { BlueprintParser } from '../../runtime-core/dist/blueprint/loader.js'

const quickStartPath = new URL('../src/content/docs/getting-started/quick-start.mdx', import.meta.url)

async function loadQuickStartBlueprint() {
  const markdown = await readFile(quickStartPath, 'utf8')
  const match = markdown.match(/## Create a Blueprint[\s\S]*?```toml\n([\s\S]*?)\n```/)

  assert.ok(match, 'The quickstart must contain a TOML blueprint code block')

  return new BlueprintParser().parse(match[1], 'toml', quickStartPath.pathname)
}

const authenticatedSession = {
  id: 'quickstart-test-session',
  userId: 'quickstart-test-user',
  user: {
    id: 'quickstart-test-user',
    email: 'author@example.com',
    name: 'Quickstart Author',
  },
  createdAt: new Date(0),
  expiresAt: new Date('9999-12-31T23:59:59.000Z'),
}

test('quickstart blueprint parses and enables email authentication', async () => {
  const blueprint = await loadQuickStartBlueprint()

  assert.deepEqual(blueprint.auth?.providers, ['email'])
  assert.deepEqual(blueprint.auth?.trustedOrigins, ['http://localhost:3000'])
  assert.ok(blueprint.entities.some((entity) => entity.name === 'Post'))
})

test('quickstart pages keep reading public and require auth for posting', async () => {
  const blueprint = await loadQuickStartBlueprint()
  const pages = new Map(blueprint.pages.map((page) => [page.path, page]))

  assert.equal(pages.get('/')?.auth, 'none')
  assert.equal(pages.get('/posts/:id')?.auth, 'none')
  assert.equal(pages.get('/posts/new')?.auth, 'required')
  assert.equal(pages.get('/posts/new')?.form?.method, 'create')
})

test('quickstart Post access allows public reads and authenticated writes only', async () => {
  const blueprint = await loadQuickStartBlueprint()
  const post = blueprint.entities.find((entity) => entity.name === 'Post')

  assert.ok(post, 'The quickstart must define the Post entity')

  for (const action of ['read', 'create', 'update', 'delete']) {
    const anonymousAllowed = await AccessControl.checkAccess({
      action,
      entity: post,
      session: null,
      data: {},
    })
    const authenticatedAllowed = await AccessControl.checkAccess({
      action,
      entity: post,
      session: authenticatedSession,
      data: {},
    })

    assert.equal(anonymousAllowed, action === 'read', `anonymous ${action} access`)
    assert.equal(authenticatedAllowed, true, `authenticated ${action} access`)
  }
})

test('quickstart Post entity declares sample seed posts', async () => {
  const blueprint = await loadQuickStartBlueprint()
  const post = blueprint.entities.find((entity) => entity.name === 'Post')

  assert.ok(post?.seed && post.seed.length >= 3, 'Post must declare sample seed records')
  for (const record of post.seed) {
    assert.equal(typeof record.title, 'string')
    assert.equal(typeof record.body, 'string')
  }
})
