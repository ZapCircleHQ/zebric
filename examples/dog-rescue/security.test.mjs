import assert from 'node:assert/strict'
import test from 'node:test'
import { withExample, denied } from '../security-test-helpers.mjs'

test('Dog Rescue rejects forged lifecycle writes and atomically claims public interest', { timeout: 120000 }, () =>
  withExample('dog-rescue', 2, async app => {
    await app.seed('FriendlyPaws!Demo1')
    await app.seed('FriendlyPaws!Demo1')
    assert.equal(app.rows('SELECT id FROM volunteer').length, 3)
    const volunteer = await app.signIn('maya@friendlypaws.example', 'FriendlyPaws!Demo1')
    const coordinator = await app.signIn('eli@friendlypaws.example', 'FriendlyPaws!Demo1')
    const publicRequest = app.client()
    const finn = app.rows("SELECT id FROM dog WHERE name='Finn'")[0]
    const seeded = app.rows('SELECT id FROM adoption_application LIMIT 1')[0]
    await denied(await volunteer(`/api/adoptionapplications/${seeded.id}`, { status: 'Approved' }, 'PUT'))
    await denied(await volunteer(`/api/adoptionapplications/${seeded.id}`, { dogId: finn.id }, 'PUT'))
    await denied(await coordinator(`/api/dogs/${finn.id}`, { status: 'Available' }, 'PUT'))
    const interest = { firstName: 'Public', lastName: 'Applicant', email: 'public@security.example', ownsOrRents: 'Owns', hasExistingPets: false }
    await denied(await publicRequest('/api/adoptioninterests', { ...interest, dogId: finn.id, dog: { status: 'Available', applicationId: null } }))
    await denied(await publicRequest('/api/adoptioninterests', { ...interest, dogId: 'missing-dog' }))
    const cooper = app.rows("SELECT id FROM dog WHERE name='Cooper'")[0]
    const submissions = await Promise.all([publicRequest('/api/adoptioninterests', { ...interest, dogId: cooper.id }),
      publicRequest('/api/adoptioninterests', { ...interest, dogId: cooper.id })])
    assert.ok(submissions.some(response => response.status === 201))
    await app.waitFor(() => app.rows(`SELECT application_id FROM dog WHERE id='${cooper.id}'`)[0]?.application_id)
    await app.waitFor(() => app.rows("SELECT id FROM __zbl_workflow_jobs WHERE status IN ('pending','running')").length === 0)
    const applications = app.rows(`SELECT * FROM adoption_application WHERE dog_id='${cooper.id}'`)
    assert.equal(applications.length, 1)
    const application = applications[0]
    // A changed login email must keep the same Volunteer identity.
    app.rows("UPDATE user SET email='maya-new@friendlypaws.example' WHERE email='maya@friendlypaws.example'")
    const renamed = await app.signIn('maya-new@friendlypaws.example', 'FriendlyPaws!Demo1')
    await app.action(renamed, 'ReviewApplication', 'AdoptionApplication', application.id, '/applications/:id')
    assert.equal(app.rows(`SELECT reviewed_by FROM adoption_application WHERE id='${application.id}'`)[0].reviewed_by,
      app.rows("SELECT id FROM volunteer WHERE email='maya@friendlypaws.example'")[0].id)
    await app.action(coordinator, 'ApproveApplication', 'AdoptionApplication', application.id, '/applications/:id')
    await app.action(coordinator, 'CompleteAdoption', 'AdoptionApplication', application.id, '/applications/:id')
    assert.equal(app.rows(`SELECT status FROM dog WHERE id='${cooper.id}'`)[0].status, 'Adopted')
    await denied(await publicRequest('/api/adoptioninterests', { ...interest, dogId: cooper.id }))
    const bella = app.rows("SELECT id FROM dog WHERE name='Bella' LIMIT 1")[0]
    assert.equal((await publicRequest('/api/adoptioninterests', { ...interest, dogId: bella.id })).status, 201)
    const rejected = await app.waitFor(() => app.rows(`SELECT application_id FROM dog WHERE id='${bella.id}'`)[0]?.application_id)
    await app.action(coordinator, 'RejectApplication', 'AdoptionApplication', rejected, '/applications/:id')
    assert.equal(app.rows(`SELECT status FROM dog WHERE id='${bella.id}'`)[0].status, 'Available')
    assert.equal((await publicRequest('/api/adoptioninterests', { ...interest, dogId: bella.id })).status, 201)
    await app.waitFor(() => app.rows(`SELECT application_id FROM dog WHERE id='${bella.id}'`)[0]?.application_id)
    assert.notEqual(app.rows(`SELECT application_id FROM dog WHERE id='${bella.id}'`)[0].application_id, rejected)

  }))
