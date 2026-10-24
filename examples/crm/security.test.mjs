import assert from 'node:assert/strict'
import test from 'node:test'
import { withExample, denied } from '../security-test-helpers.mjs'

test('CRM uses stored active team membership and independent immutable review', { timeout: 120000 }, () =>
  withExample('crm', 0, async app => {
    await app.seed('CrmDemo1!')
    const sarah = await app.signIn('sarah@crm.local', 'CrmDemo1!')
    const nia = await app.signIn('nia@crm.local', 'CrmDemo1!')
    const mike = await app.signIn('mike@crm.local', 'CrmDemo1!')
    const admin = await app.signIn('admin@crm.local', 'CrmDemo1!')
    const sarahId = app.rows("SELECT id FROM user WHERE email='sarah@crm.local'")[0].id
    const niaId = app.rows("SELECT id FROM user WHERE email='nia@crm.local'")[0].id
    assert.equal((await sarah('/api/crmaccounts/acct_1')).status, 200)
    assert.equal((await sarah('/api/crmaccounts/acct_2')).status, 404)
    await denied(await sarah('/api/contacts', { accountId: 'acct_2', teamId: 'team_sarah',
      firstName: 'Forged', lastName: 'Link', ownerId: sarahId, ownerName: 'Sarah', assistantEmail: 'sarah@crm.local' }))
    await denied(await sarah('/api/crmaccounts/acct_1', { teamId: 'team_mike' }, 'PUT'))
    const contact = await app.create(sarah, 'Contact', { accountId: 'acct_1', teamId: 'team_sarah',
      firstName: 'Real', lastName: 'Contact', ownerId: sarahId, ownerName: 'Sarah' })
    assert.equal((await nia(`/api/contacts/${contact.id}`)).status, 200)
    await app.skill(sarah, '/api/agent/leads/lead_1/prepare-outreach', {
      conversationId: 'conv_outreach_1', accountId: 'acct_1', contactId: 'contact_1', leadId: null,
      sender: 'sales@example.test', recipients: 'contact1@example.test', subject: 'Security review draft',
      body: 'Original content', reviewerId: niaId, reviewerName: 'Nia', reviewDueAt: '2026-11-01T00:00:00Z' })
    const message = app.rows("SELECT * FROM message WHERE subject='Security review draft'")[0]
    assert.equal(message.created_by_id, sarahId)
    assert.equal(message.status, 'pending_review')
    await denied(await sarah(`/api/messages/${message.id}`, { reviewerId: sarahId }, 'PUT'))
    await denied(await sarah(`/api/messages/${message.id}`, { body: 'Tampered' }, 'PUT'))
    await denied(await app.command(sarah, 'ApproveOutreachMessage', message.id, { body: 'Original content' }))
    await app.action(nia, 'ApproveOutreach', 'Message', message.id, '/messages/:id', { body: 'Original content' })
    assert.equal(app.rows(`SELECT status FROM message WHERE id='${message.id}'`)[0].status, 'approved')
    await denied(await sarah(`/api/messages/${message.id}`, { recipients: 'other@example.test' }, 'PUT'))
    await denied(await mike(`/api/messages/${message.id}`, { body: 'Cross team' }, 'PUT'))
    // Losing a membership must override every stale owner/email snapshot.
    assert.ok((await admin('/api/teammemberships/member_nia', { active: false }, 'PUT')).ok)
    assert.equal((await nia('/api/crmaccounts/acct_1')).status, 404)
    assert.equal((await nia(`/api/messages/${message.id}`)).status, 404)
    for (const path of ['/', '/accounts', '/leads', '/pipeline', '/messages', '/tasks', '/prospecting']) {
      assert.equal((await admin(path)).status, 200, path)
    }
  }))
