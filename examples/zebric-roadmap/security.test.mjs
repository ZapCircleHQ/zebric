import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { withExample, denied } from '../security-test-helpers.mjs'

test('Roadmap signup creates viewers; explicitly provisioned editors manage private planning', { timeout: 60000 }, () =>
  withExample('zebric-roadmap', 3, async app => {
    const viewer = await app.provision('user', 'viewer')
    const cookieJar = `${app.dir}/editor.cookies`
    await promisify(execFile)('bash', [fileURLToPath(new URL('./seed-dev-user.sh', import.meta.url))], {
      env: { ...process.env, BASE_URL: app.base, DB_PATH: app.dbPath,
        COOKIE_JAR: cookieJar, DEV_EMAIL: 'editor@security.example', DEV_PASSWORD: 'SecurityTest123!' },
      timeout: 30000,
    })
    assert.equal(app.rows("SELECT role FROM user WHERE email='editor@security.example'")[0].role, 'editor')
    assert.ok((await readFile(cookieJar, 'utf8')).includes('session_token'))
    const editor = { request: await app.signIn('editor@security.example', 'SecurityTest123!') }
    const publicRequest = app.client()
    await denied(await viewer.request('/api/themes', { title: 'Unapproved editor', summary: 'Blocked' }))
    const theme = await app.create(editor.request, 'Theme', { title: 'Theme', summary: 'Public', active: true })
    const item = await app.create(editor.request, 'RoadmapItem', { title: 'Internal', summary: 'Secret', themeId: theme.id, visibility: 'internal' })
    assert.equal((await viewer.request(`/api/roadmapitems/${item.id}`)).status, 404)
    assert.equal((await publicRequest(`/api/roadmapitems/${item.id}`)).status, 404)
    await denied(await viewer.request(`/api/roadmapitems/${item.id}`, { visibility: 'public' }, 'PUT'))
    assert.ok((await editor.request(`/api/roadmapitems/${item.id}`, { visibility: 'public' }, 'PUT')).ok)
    assert.equal((await publicRequest(`/api/roadmapitems/${item.id}`)).status, 200)
    await denied(await viewer.request(`/api/themes/${theme.id}`, {}, 'DELETE'))
  }))
