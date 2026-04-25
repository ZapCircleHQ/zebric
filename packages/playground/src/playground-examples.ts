import type { SimulatorAccount, SimulatorSeeds } from '@zebric/runtime-simulator'
import requestApprovalToml from './blueprints/request-approval.toml?raw'
import employeeOnboardingToml from './blueprints/employee-onboarding.toml?raw'
import incidentIntakeToml from './blueprints/incident-intake.toml?raw'
import assetRequestToml from './blueprints/asset-request.toml?raw'
import issueTrackerToml from './blueprints/issue-tracker.toml?raw'

export interface PlaygroundScenario {
  name: string
  label: string
  description: string
}

export interface PlaygroundDocLink {
  label: string
  href: string
}

export interface PlaygroundExample {
  slug: string
  title: string
  description: string
  tags: string[]
  features: string[]
  blueprintPath: string
  blueprintToml: string
  seeds: SimulatorSeeds
  defaultScenario: string
  defaultRole: string
  accounts: SimulatorAccount[]
  scenarios: PlaygroundScenario[]
  trySteps: string[]
  githubUrl: string
  runLocallyUrl: string
  docsUrls: PlaygroundDocLink[]
  notes: string
}

const dispatchAccounts: SimulatorAccount[] = [
  {
    id: 'requester',
    email: 'requester@example.test',
    name: 'Requester',
    role: 'requester',
    roles: ['requester'],
  },
  {
    id: 'manager',
    email: 'manager@example.test',
    name: 'Manager',
    role: 'manager',
    roles: ['manager'],
  },
  {
    id: 'admin',
    email: 'admin@example.test',
    name: 'Admin',
    role: 'admin',
    roles: ['admin'],
  },
]

const peopleAccounts: SimulatorAccount[] = [
  {
    id: 'peopleops',
    email: 'peopleops@example.test',
    name: 'People Ops',
    role: 'peopleops',
    roles: ['peopleops'],
  },
  {
    id: 'manager',
    email: 'manager@example.test',
    name: 'Manager',
    role: 'manager',
    roles: ['manager'],
  },
  {
    id: 'it',
    email: 'it@example.test',
    name: 'IT Admin',
    role: 'it',
    roles: ['it'],
  },
]

const operationsAccounts: SimulatorAccount[] = [
  {
    id: 'reporter',
    email: 'reporter@example.test',
    name: 'Reporter',
    role: 'reporter',
    roles: ['reporter'],
  },
  {
    id: 'triage',
    email: 'triage@example.test',
    name: 'Triage Lead',
    role: 'triage',
    roles: ['triage'],
  },
  {
    id: 'commander',
    email: 'commander@example.test',
    name: 'Commander',
    role: 'commander',
    roles: ['commander'],
  },
]

const issueTrackerAccounts: SimulatorAccount[] = [
  {
    id: 'pm',
    email: 'pm@example.test',
    name: 'Product Manager',
    role: 'pm',
    roles: ['pm'],
  },
  {
    id: 'engineer',
    email: 'engineer@example.test',
    name: 'Engineer',
    role: 'engineer',
    roles: ['engineer'],
  },
  {
    id: 'designer',
    email: 'designer@example.test',
    name: 'Designer',
    role: 'designer',
    roles: ['designer'],
  },
  {
    id: 'support',
    email: 'support@example.test',
    name: 'Support Lead',
    role: 'support',
    roles: ['support'],
  },
]

export const examples: PlaygroundExample[] = [
  {
    slug: 'issue-tracker',
    title: 'Issue Tracker',
    description:
      'A board-first issue tracker with drag-and-drop planning, issue search, detail pages, and editable issue records.',
    tags: ['widgets', 'planning', 'search', 'issues'],
    features: ['Board widget workflow', 'Lookup-based issue jump page', 'Issue detail with comments', 'Editable project backlog'],
    blueprintPath: 'src/blueprints/issue-tracker.toml',
    blueprintToml: issueTrackerToml,
    seeds: {
      sprint: {
        Project: [
          { id: 'proj-web', name: 'Web App', key: 'WEB', leadName: 'Product Manager' },
          { id: 'proj-ops', name: 'Operations Console', key: 'OPS', leadName: 'Support Lead' },
        ],
        IssueColumn: [
          { id: 'backlog', name: 'Backlog', position: 0 },
          { id: 'planned', name: 'Planned', position: 1 },
          { id: 'in_progress', name: 'In Progress', position: 2 },
          { id: 'review', name: 'Review', position: 3 },
          { id: 'done', name: 'Done', position: 4 },
        ],
        TeamMember: [
          { id: 'pm', name: 'Parker PM', email: 'pm@example.test', role: 'pm' },
          { id: 'engineer', name: 'Emerson Engineer', email: 'engineer@example.test', role: 'engineer' },
          { id: 'designer', name: 'Dana Designer', email: 'designer@example.test', role: 'designer' },
          { id: 'support', name: 'Skyler Support', email: 'support@example.test', role: 'support' },
        ],
        Issue: [
          {
            id: 'iss-101',
            key: 'WEB-101',
            title: 'Support drag-and-drop issue planning',
            summary: 'Implement board movement so triage and planning happen directly on the main board.',
            projectId: 'proj-web',
            projectName: 'Web App',
            status: 'in_progress',
            columnId: 'in_progress',
            position: 0,
            priority: 'p1',
            important: true,
            assigneeId: 'engineer',
            assigneeName: 'Emerson Engineer',
            reporterId: 'pm',
            reporterName: 'Parker PM',
            estimate: 5,
            createdAt: '2026-04-20T09:00:00Z',
          },
          {
            id: 'iss-102',
            key: 'WEB-118',
            title: 'Refine issue detail layout',
            summary: 'Improve the issue detail page so comments and implementation notes are easier to scan.',
            projectId: 'proj-web',
            projectName: 'Web App',
            status: 'review',
            columnId: 'review',
            position: 0,
            priority: 'p2',
            important: false,
            assigneeId: 'designer',
            assigneeName: 'Dana Designer',
            reporterId: 'pm',
            reporterName: 'Parker PM',
            estimate: 3,
            createdAt: '2026-04-18T14:30:00Z',
          },
          {
            id: 'iss-103',
            key: 'OPS-44',
            title: 'Add issue finder for support handoff',
            summary: 'Create a quick issue search page so support can jump to open work by key or title.',
            projectId: 'proj-ops',
            projectName: 'Operations Console',
            status: 'backlog',
            columnId: 'backlog',
            position: 0,
            priority: 'p1',
            important: false,
            assigneeId: 'support',
            assigneeName: 'Skyler Support',
            reporterId: 'support',
            reporterName: 'Skyler Support',
            estimate: 2,
            createdAt: '2026-04-21T11:15:00Z',
          },
          {
            id: 'iss-104',
            key: 'OPS-48',
            title: 'Close the loop on completed incidents',
            summary: 'Ensure finished operational issues are moved to done and documented with comments.',
            projectId: 'proj-ops',
            projectName: 'Operations Console',
            status: 'done',
            columnId: 'done',
            position: 0,
            priority: 'p3',
            important: false,
            assigneeId: 'support',
            assigneeName: 'Skyler Support',
            reporterId: 'pm',
            reporterName: 'Parker PM',
            estimate: 1,
            createdAt: '2026-04-17T16:45:00Z',
          },
        ],
        IssueComment: [
          { id: 'com-1', issueId: 'iss-101', authorName: 'Parker PM', body: 'Need this stable enough for sprint planning next week.', createdAt: '2026-04-20T10:00:00Z' },
          { id: 'com-2', issueId: 'iss-101', authorName: 'Emerson Engineer', body: 'Board movement is working locally; polishing persistence and ordering now.', createdAt: '2026-04-21T09:30:00Z' },
          { id: 'com-3', issueId: 'iss-102', authorName: 'Dana Designer', body: 'Adjusted spacing and hierarchy for comments and metadata.', createdAt: '2026-04-19T12:15:00Z' },
        ],
      },
      backlog: {
        Project: [
          { id: 'proj-web', name: 'Web App', key: 'WEB', leadName: 'Product Manager' },
        ],
        IssueColumn: [
          { id: 'backlog', name: 'Backlog', position: 0 },
          { id: 'planned', name: 'Planned', position: 1 },
          { id: 'in_progress', name: 'In Progress', position: 2 },
          { id: 'review', name: 'Review', position: 3 },
          { id: 'done', name: 'Done', position: 4 },
        ],
        TeamMember: [
          { id: 'pm', name: 'Parker PM', email: 'pm@example.test', role: 'pm' },
          { id: 'engineer', name: 'Emerson Engineer', email: 'engineer@example.test', role: 'engineer' },
        ],
        Issue: [
          {
            id: 'iss-201',
            key: 'WEB-201',
            title: 'Draft initial keyboard shortcuts',
            summary: 'Shape the first pass of issue navigation shortcuts.',
            projectId: 'proj-web',
            projectName: 'Web App',
            status: 'backlog',
            columnId: 'backlog',
            position: 0,
            priority: 'p2',
            important: false,
            assigneeId: 'engineer',
            assigneeName: 'Emerson Engineer',
            reporterId: 'pm',
            reporterName: 'Parker PM',
            estimate: 2,
            createdAt: '2026-04-22T08:00:00Z',
          },
        ],
        IssueComment: [],
      },
      empty: {
        Project: [
          { id: 'proj-web', name: 'Web App', key: 'WEB', leadName: 'Product Manager' },
        ],
        IssueColumn: [
          { id: 'backlog', name: 'Backlog', position: 0 },
          { id: 'planned', name: 'Planned', position: 1 },
          { id: 'in_progress', name: 'In Progress', position: 2 },
          { id: 'review', name: 'Review', position: 3 },
          { id: 'done', name: 'Done', position: 4 },
        ],
        TeamMember: [
          { id: 'pm', name: 'Parker PM', email: 'pm@example.test', role: 'pm' },
          { id: 'engineer', name: 'Emerson Engineer', email: 'engineer@example.test', role: 'engineer' },
        ],
        Issue: [],
        IssueComment: [],
      },
    },
    defaultScenario: 'sprint',
    defaultRole: 'pm',
    accounts: issueTrackerAccounts,
    scenarios: [
      { name: 'sprint', label: 'Active sprint', description: 'A mixed board with active work, review items, and seeded comments.' },
      { name: 'backlog', label: 'Backlog-heavy', description: 'Most work is still being shaped before planning.' },
      { name: 'empty', label: 'Empty tracker', description: 'Projects and columns exist, but no issues have been created yet.' },
    ],
    trySteps: [
      'Open the board and drag a backlog issue into Planned or In Progress.',
      'Toggle the importance flag on a card to reprioritize it.',
      'Open Find Issues and search by issue key or assignee name.',
      'Jump into an issue detail page from search results.',
      'Open Edit Issue and update the title, status, or summary.',
    ],
    githubUrl: 'https://github.com/zapcirclehq/zebric/tree/main/packages/playground/src/blueprints/issue-tracker.toml',
    runLocallyUrl: 'https://github.com/zapcirclehq/zebric#readme',
    docsUrls: [
      { label: 'Widgets', href: 'https://docs.zebric.dev/building/widgets/' },
      { label: 'Board widget', href: 'https://docs.zebric.dev/building/widgets/board/' },
      { label: 'Lookup widget', href: 'https://docs.zebric.dev/building/widgets/lookup/' },
    ],
    notes: 'This first pass is intentionally board-first: movement and search are real, while workflows and richer issue automation can be layered in next.',
  },
  {
    slug: 'request-approval',
    title: 'Request Approval',
    description:
      'A purchasing approval flow with requester, manager, and admin views, audit events, and simulated notifications.',
    tags: ['workflows', 'roles', 'audit', 'notifications'],
    features: ['Role-specific request flow', 'Manual approval workflow', 'Audit trail records', 'Slack notification simulation'],
    blueprintPath: 'src/blueprints/request-approval.toml',
    blueprintToml: requestApprovalToml,
    seeds: {
      mixed: {
        TeamMember: [
          { id: 'requester', name: 'Riley Requester', email: 'requester@example.test', role: 'requester', department: 'Support' },
          { id: 'manager', name: 'Morgan Manager', email: 'manager@example.test', role: 'manager', department: 'Operations' },
          { id: 'admin', name: 'Avery Admin', email: 'admin@example.test', role: 'admin', department: 'Finance' },
        ],
        ApprovalRequest: [
          {
            id: 'req-100',
            title: 'Vendor analytics renewal',
            amount: 7800,
            status: 'pending_manager',
            category: 'software',
            requesterId: 'requester',
            managerId: 'manager',
            justification: 'Renew the product analytics service before the current contract expires.',
            createdAt: '2026-04-10T14:30:00Z',
          },
          {
            id: 'req-101',
            title: 'Support headset refresh',
            amount: 1200,
            status: 'approved',
            category: 'hardware',
            requesterId: 'requester',
            managerId: 'manager',
            justification: 'Replace worn devices for frontline support.',
            createdAt: '2026-04-08T10:15:00Z',
          },
        ],
        ApprovalAudit: [
          { id: 'aud-100', requestId: 'req-101', actorId: 'manager', action: 'approved', note: 'Approved for Q2 support budget.', createdAt: '2026-04-09T09:15:00Z' },
        ],
      },
      empty: {
        TeamMember: [
          { id: 'requester', name: 'Riley Requester', email: 'requester@example.test', role: 'requester', department: 'Support' },
          { id: 'manager', name: 'Morgan Manager', email: 'manager@example.test', role: 'manager', department: 'Operations' },
          { id: 'admin', name: 'Avery Admin', email: 'admin@example.test', role: 'admin', department: 'Finance' },
        ],
        ApprovalRequest: [],
        ApprovalAudit: [],
      },
      completed: {
        TeamMember: [
          { id: 'requester', name: 'Riley Requester', email: 'requester@example.test', role: 'requester', department: 'Support' },
          { id: 'manager', name: 'Morgan Manager', email: 'manager@example.test', role: 'manager', department: 'Operations' },
          { id: 'admin', name: 'Avery Admin', email: 'admin@example.test', role: 'admin', department: 'Finance' },
        ],
        ApprovalRequest: [
          {
            id: 'req-200',
            title: 'Security training seats',
            amount: 2400,
            status: 'approved',
            category: 'training',
            requesterId: 'requester',
            managerId: 'manager',
            justification: 'Annual secure coding training for the platform team.',
            createdAt: '2026-04-01T12:00:00Z',
          },
        ],
        ApprovalAudit: [
          { id: 'aud-200', requestId: 'req-200', actorId: 'requester', action: 'submitted', note: 'Request submitted.', createdAt: '2026-04-01T12:00:00Z' },
          { id: 'aud-201', requestId: 'req-200', actorId: 'manager', action: 'approved', note: 'Approved.', createdAt: '2026-04-02T12:00:00Z' },
        ],
      },
    },
    defaultScenario: 'mixed',
    defaultRole: 'requester',
    accounts: dispatchAccounts,
    scenarios: [
      { name: 'mixed', label: 'Mixed dataset', description: 'Pending and approved requests with audit records.' },
      { name: 'empty', label: 'Empty state', description: 'Members exist, but no requests have been created.' },
      { name: 'completed', label: 'Completed workflow', description: 'A request with submitted and approved history.' },
    ],
    trySteps: [
      'Stay as Requester and open New Request.',
      'Create a software request with a clear justification.',
      'Switch to Manager in the simulator toolbar.',
      'Open the request detail page and trigger Approve request.',
      'Inspect the workflow and audit tabs.',
    ],
    githubUrl: 'https://github.com/zapcirclehq/zebric/tree/main/packages/playground/src/blueprints/request-approval.toml',
    runLocallyUrl: 'https://github.com/zapcirclehq/zebric#readme',
    docsUrls: [
      { label: 'Blueprint guide', href: 'https://docs.zebric.dev/building/blueprint/' },
      { label: 'Workflows', href: 'https://docs.zebric.dev/building/workflows/' },
    ],
    notes: 'Workflow steps are traced in the browser. External Slack and email effects are simulated.',
  },
  {
    slug: 'employee-onboarding',
    title: 'Employee Onboarding',
    description:
      'A people operations workspace for tracking new hires, access provisioning, task lists, and ramp milestones.',
    tags: ['checklists', 'roles', 'operations'],
    features: ['Checklist workflow', 'Multiple operational roles', 'Access provisioning state', 'Ramp milestone review'],
    blueprintPath: 'src/blueprints/employee-onboarding.toml',
    blueprintToml: employeeOnboardingToml,
    seeds: {
      pending: {
        Employee: [
          { id: 'emp-1', fullName: 'Sam Patel', email: 'sam@example.test', team: 'Platform', roleTitle: 'Backend Engineer', startDate: '2026-04-22', status: 'preboarding', managerId: 'manager' },
        ],
        OnboardingTask: [
          { id: 'task-1', employeeId: 'emp-1', title: 'Ship laptop', owner: 'IT', status: 'in_progress', dueDate: '2026-04-19' },
          { id: 'task-2', employeeId: 'emp-1', title: 'Prepare team intro', owner: 'Manager', status: 'todo', dueDate: '2026-04-22' },
        ],
        AccessGrant: [
          { id: 'access-1', employeeId: 'emp-1', system: 'GitHub', status: 'requested', owner: 'IT' },
          { id: 'access-2', employeeId: 'emp-1', system: 'HRIS', status: 'provisioned', owner: 'People Ops' },
        ],
      },
      empty: { Employee: [], OnboardingTask: [], AccessGrant: [] },
      complete: {
        Employee: [
          { id: 'emp-2', fullName: 'Jules Rivera', email: 'jules@example.test', team: 'Design', roleTitle: 'Product Designer', startDate: '2026-03-18', status: 'complete', managerId: 'manager' },
        ],
        OnboardingTask: [
          { id: 'task-3', employeeId: 'emp-2', title: 'Complete security training', owner: 'Employee', status: 'done', dueDate: '2026-03-20' },
        ],
        AccessGrant: [
          { id: 'access-3', employeeId: 'emp-2', system: 'Figma', status: 'provisioned', owner: 'IT' },
        ],
      },
    },
    defaultScenario: 'pending',
    defaultRole: 'peopleops',
    accounts: peopleAccounts,
    scenarios: [
      { name: 'pending', label: 'Pending onboarding', description: 'One new hire with tasks and access grants in progress.' },
      { name: 'empty', label: 'Empty state', description: 'No hires have been added yet.' },
      { name: 'complete', label: 'Completed workflow', description: 'A completed onboarding record.' },
    ],
    trySteps: [
      'Open the employee profile for Sam Patel.',
      'Review tasks and access grants in the detail view.',
      'Trigger Start day one from the action bar.',
      'Switch to IT Admin and inspect the access data.',
      'Reset the seed to return to the pending state.',
    ],
    githubUrl: 'https://github.com/zapcirclehq/zebric/tree/main/packages/playground/src/blueprints/employee-onboarding.toml',
    runLocallyUrl: 'https://github.com/zapcirclehq/zebric#readme',
    docsUrls: [{ label: 'Blueprint guide', href: 'https://docs.zebric.dev/building/blueprint/' }],
    notes: 'This example focuses on operational coordination across people, manager, and IT roles.',
  },
  {
    slug: 'incident-intake',
    title: 'Incident Intake',
    description:
      'A structured intake and triage flow for operational incidents, severity assignment, ownership, and communications.',
    tags: ['forms', 'triage', 'workflows'],
    features: ['Structured incident form', 'Triage action bar', 'Severity and status tracking', 'Notification simulation'],
    blueprintPath: 'src/blueprints/incident-intake.toml',
    blueprintToml: incidentIntakeToml,
    seeds: {
      active: {
        Incident: [
          { id: 'inc-1', title: 'Checkout latency spike', severity: 'sev2', status: 'triage', service: 'Checkout', reporterId: 'reporter', ownerId: 'triage', impact: 'Elevated latency for payment confirmation.', createdAt: '2026-04-17T13:05:00Z' },
          { id: 'inc-2', title: 'Warehouse sync delay', severity: 'sev3', status: 'monitoring', service: 'Inventory', reporterId: 'reporter', ownerId: 'commander', impact: 'Delayed stock updates in admin views.', createdAt: '2026-04-16T16:20:00Z' },
        ],
        IncidentUpdate: [
          { id: 'upd-1', incidentId: 'inc-1', authorId: 'triage', body: 'Traffic shifted to the fallback queue.', createdAt: '2026-04-17T13:20:00Z' },
        ],
      },
      empty: { Incident: [], IncidentUpdate: [] },
      resolved: {
        Incident: [
          { id: 'inc-3', title: 'Email webhook backlog', severity: 'sev3', status: 'resolved', service: 'Notifications', reporterId: 'reporter', ownerId: 'commander', impact: 'Customer emails delayed by ten minutes.', createdAt: '2026-04-14T09:00:00Z' },
        ],
        IncidentUpdate: [
          { id: 'upd-2', incidentId: 'inc-3', authorId: 'commander', body: 'Backlog drained and provider limits restored.', createdAt: '2026-04-14T10:15:00Z' },
        ],
      },
    },
    defaultScenario: 'active',
    defaultRole: 'triage',
    accounts: operationsAccounts,
    scenarios: [
      { name: 'active', label: 'Active incidents', description: 'Triage and monitoring incidents with updates.' },
      { name: 'empty', label: 'Empty state', description: 'No incidents have been reported.' },
      { name: 'resolved', label: 'Resolved workflow', description: 'One incident with a resolution update.' },
    ],
    trySteps: [
      'Create a new incident from the intake form.',
      'Open the incident detail page.',
      'Trigger Declare incident or Move to monitoring.',
      'Open the integrations and workflow tabs.',
      'Switch to Commander and reset to the active scenario.',
    ],
    githubUrl: 'https://github.com/zapcirclehq/zebric/tree/main/packages/playground/src/blueprints/incident-intake.toml',
    runLocallyUrl: 'https://github.com/zapcirclehq/zebric#readme',
    docsUrls: [
      { label: 'Forms', href: 'https://docs.zebric.dev/building/blueprint/' },
      { label: 'Workflows', href: 'https://docs.zebric.dev/building/workflows/' },
    ],
    notes: 'The structured form and action bar model a repeatable incident operating rhythm.',
  },
  {
    slug: 'asset-request',
    title: 'Asset and Inventory Request',
    description:
      'A lightweight inventory desk for requesting assets, approving fulfillment, and tracking available stock.',
    tags: ['crud', 'approvals', 'inventory'],
    features: ['CRUD-backed catalog', 'Approval workflow', 'Inventory request state', 'Fulfillment audit trail'],
    blueprintPath: 'src/blueprints/asset-request.toml',
    blueprintToml: assetRequestToml,
    seeds: {
      mixed: {
        Asset: [
          { id: 'asset-1', name: 'MacBook Pro 14', category: 'laptop', stock: 4, ownerTeam: 'IT' },
          { id: 'asset-2', name: 'YubiKey 5C NFC', category: 'security', stock: 18, ownerTeam: 'Security' },
        ],
        AssetRequest: [
          { id: 'ar-1', assetName: 'MacBook Pro 14', requesterId: 'requester', status: 'pending_approval', quantity: 1, businessReason: 'Replacement for an aging laptop.' },
          { id: 'ar-2', assetName: 'YubiKey 5C NFC', requesterId: 'requester', status: 'fulfilled', quantity: 2, businessReason: 'Hardware MFA rollout.' },
        ],
      },
      empty: {
        Asset: [
          { id: 'asset-1', name: 'MacBook Pro 14', category: 'laptop', stock: 4, ownerTeam: 'IT' },
          { id: 'asset-2', name: 'YubiKey 5C NFC', category: 'security', stock: 18, ownerTeam: 'Security' },
        ],
        AssetRequest: [],
      },
      pending: {
        Asset: [
          { id: 'asset-3', name: 'Ultrawide Monitor', category: 'peripheral', stock: 2, ownerTeam: 'Workplace' },
        ],
        AssetRequest: [
          { id: 'ar-3', assetName: 'Ultrawide Monitor', requesterId: 'requester', status: 'submitted', quantity: 1, businessReason: 'Accessibility setup for design review work.' },
        ],
      },
    },
    defaultScenario: 'mixed',
    defaultRole: 'requester',
    accounts: dispatchAccounts,
    scenarios: [
      { name: 'mixed', label: 'Mixed dataset', description: 'Catalog stock with pending and fulfilled requests.' },
      { name: 'empty', label: 'Empty state', description: 'Catalog exists, requests are empty.' },
      { name: 'pending', label: 'Pending approval', description: 'A submitted request ready for manager review.' },
    ],
    trySteps: [
      'Open Asset Requests and create a new request.',
      'Use the data tab to verify the in-memory record.',
      'Switch to Manager.',
      'Open a request and trigger Approve asset request.',
      'Reset the scenario and compare the request list.',
    ],
    githubUrl: 'https://github.com/zapcirclehq/zebric/tree/main/packages/playground/src/blueprints/asset-request.toml',
    runLocallyUrl: 'https://github.com/zapcirclehq/zebric#readme',
    docsUrls: [{ label: 'CRUD apps', href: 'https://docs.zebric.dev/building/blueprint/' }],
    notes: 'This example highlights create forms, list/detail views, role switching, and approval traces.',
  },
]
