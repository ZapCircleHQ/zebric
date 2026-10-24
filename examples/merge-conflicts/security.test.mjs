import assert from 'node:assert/strict'
import test from 'node:test'
import { withExample, denied } from '../security-test-helpers.mjs'

test('Merge review evidence is derived from a protected transition and its actual actor', { timeout: 60000 }, () =>
  withExample('merge-conflicts', 4, async app => {
    const admin = await app.provision('admin', 'admin')
    const reviewer = await app.provision('reviewer', 'reviewer')
    const repository = await app.create(admin.request, 'Repository', { name: 'Fixture', provider: 'local', location: 'temporary' })
    const pr = await app.create(admin.request, 'PullRequest', { repositoryId: repository.id, title: 'Fixture', baseRef: 'main', headRef: 'feature' })
    const resolution = await app.create(admin.request, 'ConflictResolution', { pullRequestId: pr.id })
    app.rows(`UPDATE conflict_resolution SET status='awaiting_approval' WHERE id='${resolution.id}'`)
    await denied(await reviewer.request('/api/reviewdecisions', { resolutionId: resolution.id, decision: 'approved', reviewerId: admin.id }))
    await denied(await reviewer.request(`/api/conflictresolutions/${resolution.id}`, { reviewedById: admin.id }, 'PUT'))
    await denied(await app.command(reviewer.request, 'ApproveConflictResolution', resolution.id, { reason: 'Forged actor', reviewerId: admin.id }))
    const response = await app.command(reviewer.request, 'ApproveConflictResolution', resolution.id, { reason: 'Verified conflict' })
    assert.equal(response.status, 200, await response.text())
    await app.waitFor(() => app.rows(`SELECT id FROM review_decision WHERE resolution_id='${resolution.id}'`).length === 1)
    const evidence = app.rows(`SELECT * FROM review_decision WHERE resolution_id='${resolution.id}'`)[0]
    assert.equal(evidence.reviewer_id, reviewer.id)
    assert.equal(evidence.decision, 'approved')
    assert.equal(evidence.reason, 'Verified conflict')
  }))
