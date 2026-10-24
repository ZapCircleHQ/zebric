import assert from 'node:assert/strict'
import test from 'node:test'
import { withExample, denied } from '../security-test-helpers.mjs'

test('Idea to Operations separates requesting a decision from recording its outcome', { timeout: 120000 }, () =>
  withExample('idea-to-operations', 1, async app => {
    await app.seed('NorthstarDemo1!')
    const user = await app.signIn('sam@northstar.local', 'NorthstarDemo1!')
    const decider = await app.signIn('dana@northstar.local', 'NorthstarDemo1!')
    const owner = await app.signIn('owen@northstar.local', 'NorthstarDemo1!')
    await denied(await user('/api/decisions', { initiativeId: 'init_usage_billing', kind: 'approve_initiative',
      question: 'Forged approval', status: 'decided', outcome: 'approved', decidedById: 'someone-else' }))
    const decision = await app.create(user, 'Decision', { initiativeId: 'init_usage_billing', kind: 'approve_initiative', question: 'Legitimate request' })
    assert.equal(decision.status, 'requested')
    assert.equal(decision.outcome, 'pending')
    await denied(await user(`/api/decisions/${decision.id}`, { outcome: 'approved' }, 'PUT'))
    await denied(await owner('/api/initiatives/init_portal', { planApprovedAt: '2026-01-01T00:00:00Z', launchApprovedAt: '2026-01-01T00:00:00Z' }, 'PUT'))
    await app.action(decider, 'RecordDecision', 'Decision', decision.id, '/decisions', {
      outcome: 'approved', decision: 'Proceed', rationale: 'Reviewed evidence', selectedAlternativeId: '' })
    const stored = app.rows(`SELECT * FROM decision WHERE id='${decision.id}'`)[0]
    assert.equal(stored.outcome, 'approved')
    assert.equal(stored.decided_by_id, app.rows("SELECT id FROM user WHERE email='dana@northstar.local'")[0].id)
    await denied(await app.command(decider, 'ApproveInitiativeState', 'init_usage_billing'))
    await denied(await decider(`/api/decisions/${decision.id}`, { initiativeId: 'init_portal' }, 'PUT'))
    const milestone = app.rows('SELECT id FROM milestone LIMIT 1')[0]
    await denied(await owner(`/api/milestones/${milestone.id}`, { status: 'completed' }, 'PUT'))
    const check = app.rows('SELECT id FROM readiness_check LIMIT 1')[0]
    await denied(await owner(`/api/readinesschecks/${check.id}`, { status: 'ready' }, 'PUT'))
  }))
