const REQUEST_TITLES = [
  'Vendor access request',
  'Customer escalation intake',
  'Data export approval',
  'Incident follow-up',
  'Security review request',
  'Procurement review',
  'Bug triage handoff',
  'Support backlog escalation',
]

const LOREM = [
  'Needs coordination across teams and downstream notifications.',
  'Contains related references and approval activity.',
  'Expected to generate follow-up comments and audits.',
  'Likely to receive webhook-driven updates from external systems.',
]

export const SEED_TIERS = {
  smoke: {
    users: 100,
    teams: 20,
    requests: 5000,
    comments: 25000,
    approvalSteps: 10000,
    auditEvents: 50000,
    notifications: 5000,
    webhookEvents: 5000,
    workflowRuns: 2000,
  },
  v1: {
    users: 1000,
    teams: 100,
    requests: 100000,
    comments: 500000,
    approvalSteps: 250000,
    auditEvents: 1000000,
    notifications: 200000,
    webhookEvents: 100000,
    workflowRuns: 50000,
  },
}

export class SeededRandom {
  constructor(seed = 1337) {
    this.seed = seed >>> 0
  }

  next() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0
    return this.seed / 0x100000000
  }

  int(max) {
    return Math.floor(this.next() * max)
  }

  pick(items) {
    return items[this.int(items.length)]
  }

  pickWeighted(items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0)
    let target = this.next() * total
    for (const item of items) {
      target -= item.weight
      if (target <= 0) {
        return item.value
      }
    }
    return items[items.length - 1]?.value
  }
}

function pad(number, width = 6) {
  return String(number).padStart(width, '0')
}

function timestampWithRecency(rng, baseMs) {
  const ageDays = Math.floor(Math.pow(rng.next(), 3.2) * 180)
  const ageMs = ageDays * 24 * 60 * 60 * 1000 + rng.int(24 * 60 * 60 * 1000)
  return new Date(baseMs - ageMs).toISOString()
}

export function buildSeedState(tierName, seedValue = 1337) {
  const tier = SEED_TIERS[tierName]
  if (!tier) {
    throw new Error(`Unknown seed tier: ${tierName}`)
  }

  const rng = new SeededRandom(seedValue)
  const baseMs = Date.now()
  const hotTeamCount = Math.max(1, Math.floor(tier.teams * 0.2))
  const hotRequestCount = Math.max(10, Math.floor(tier.requests * 0.1))

  const teams = Array.from({ length: tier.teams }, (_, index) => ({
    id: `team_${pad(index + 1, 4)}`,
    name: `Team ${index + 1}`,
    createdAt: timestampWithRecency(rng, baseMs),
  }))

  const teamIds = teams.map((team, index) => ({
    value: team.id,
    weight: index < hotTeamCount ? 12 : 2,
  }))

  const users = Array.from({ length: tier.users }, (_, index) => {
    const teamId = rng.pickWeighted(teamIds)
    return {
      id: `user_${pad(index + 1)}`,
      teamId,
      name: `Benchmark User ${index + 1}`,
      email: `user${index + 1}@big-zebra.local`,
      role: rng.pick(['operator', 'reviewer', 'manager', 'analyst']),
      createdAt: timestampWithRecency(rng, baseMs),
    }
  })

  const usersByTeam = new Map()
  for (const user of users) {
    const existing = usersByTeam.get(user.teamId) ?? []
    existing.push(user.id)
    usersByTeam.set(user.teamId, existing)
  }

  const statuses = ['new', 'triage', 'in_progress', 'awaiting_approval', 'approved', 'done']
  const priorities = ['low', 'normal', 'high', 'critical']

  const requests = Array.from({ length: tier.requests }, (_, index) => {
    const teamId = rng.pickWeighted(teamIds)
    const teamUsers = usersByTeam.get(teamId) ?? [users[0].id]
    const createdByUserId = rng.pick(teamUsers)
    const assignedToUserId = rng.pick(teamUsers)
    const title = `${rng.pick(REQUEST_TITLES)} #${index + 1}`
    return {
      id: `req_${pad(index + 1)}`,
      teamId,
      createdByUserId,
      assignedToUserId,
      title,
      description: `${title}. ${rng.pick(LOREM)}`,
      status: rng.pickWeighted([
        { value: statuses[0], weight: 18 },
        { value: statuses[1], weight: 14 },
        { value: statuses[2], weight: 25 },
        { value: statuses[3], weight: 14 },
        { value: statuses[4], weight: 9 },
        { value: statuses[5], weight: 20 },
      ]),
      priority: rng.pickWeighted([
        { value: priorities[0], weight: 8 },
        { value: priorities[1], weight: 55 },
        { value: priorities[2], weight: 27 },
        { value: priorities[3], weight: 10 },
      ]),
      createdAt: timestampWithRecency(rng, baseMs),
      updatedAt: timestampWithRecency(rng, baseMs),
    }
  })

  const hotRequestIds = requests.slice(0, hotRequestCount).map((request) => ({
    value: request.id,
    weight: 16,
  }))
  const requestIds = requests.map((request) => ({
    value: request.id,
    weight: 2,
  }))

  const tags = Array.from({ length: 24 }, (_, index) => ({
    id: `tag_${pad(index + 1, 4)}`,
    name: ['finance', 'security', 'vip', 'stale', 'integrations', 'compliance'][index % 6] + `-${index + 1}`,
  }))

  return {
    tierName,
    tier,
    rng,
    baseMs,
    teams,
    users,
    requests,
    tags,
    pickHotRequestId() {
      return rng.next() < 0.7 ? rng.pickWeighted(hotRequestIds) : rng.pickWeighted(requestIds)
    },
    pickAnyRequest() {
      return rng.pick(requests)
    },
    pickUserId(teamId) {
      const members = usersByTeam.get(teamId)
      return members?.length ? rng.pick(members) : rng.pick(users).id
    },
    pickTagId() {
      return rng.pick(tags).id
    },
    timestamp() {
      return timestampWithRecency(rng, baseMs)
    },
  }
}
