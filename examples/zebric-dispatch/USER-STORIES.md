Zebric Dispatch — User Stories (Chaotic Startup Edition)

## Implementation Checklist (Current)

Legend: `[x] done`, `[~] partial`, `[ ] not started`

- [~] 1.1 Slack Message -> Request
- [~] 1.2 Linear Ticket Sync
- [~] 1.3 GitHub Issues Sync
- [~] 1.4 Notion Docs -> Requests

- [ ] 2.1 Automatic Duplicate Detection
- [~] 2.2 Request Clustering
- [ ] 2.3 Suggested Merges

- [x] 3.1 Founder Dashboard
- [~] 3.2 Priority Scoring
- [ ] 3.3 SLA Alerts

- [ ] 4.1 Summaries
- [ ] 4.2 Behavioral Context
- [ ] 4.3 Intelligent Routing

- [ ] 5.1 Bi-Directional Sync with Linear
- [x] 5.2 GitHub PR Linking
- [x] 5.3 Slack Notification on Resolution

- [~] 6.1 Inbox Zero-Style Triage Panel
- [~] 6.2 Auto-Fill Metadata
- [ ] 6.3 Quick Assign from Slack

- [ ] 7.1 Quarter Themes View
- [x] 7.2 What’s Scheduled / What’s Not
- [x] 7.3 Change History

- [~] 8.1 Behavior-Level Impact
- [ ] 8.2 Behavior Drift Alerts
- [ ] 8.3 Suggest Behavior Updates

- [ ] 9.1 Fire Detection
- [ ] 9.2 Team Load Radar
- [ ] 9.3 Customer Trends

- [ ] 10.1 Zero Setup Import
- [ ] 10.2 No Forced Process Changes
- [ ] 10.3 Progressive Enhancement

🎯 Personas

To make this concrete, we’ll use three startup personas:
	•	Engineer Erin — overwhelmed, context-switching constantly
	•	PM Priya — juggling priorities, trying to keep things from falling apart
	•	Founder Frank — wants visibility without micromanaging
	•	Support Sam — jumps between Slack, email, and “whatever tool has the answer”

⸻

1. Unified Intake Across Slack, Linear, GitHub, Notion

Story 1.1 — Slack Message → Request

As Support Sam, when someone tags me in Slack with a customer issue,
I want to automatically convert the Slack thread into a tracked Dispatch item
so nothing falls through the cracks.

Story 1.2 — Linear Ticket Sync

As Priya, I want Dispatch to pull in Linear issues assigned to my team
so I can see engineering demand in one place without switching tools.

Story 1.3 — GitHub Issues Sync

As Erin, when a user reports a bug directly on GitHub,
I want Dispatch to collect it next to internal issues
so I don’t have to maintain two separate backlogs.

Story 1.4 — Notion Docs → Requests

As Priya, when someone comments on a Notion spec,
I want Dispatch to create a request and link back to the block
so design/engineering sees feedback early.

⸻

2. Chaos Reduction Through Deduplication + Clustering

Story 2.1 — Automatic Duplicate Detection

As Erin, I want Dispatch to use LLM-based similarity scoring
to detect duplicate requests across Slack, Linear, and GitHub
so I don’t waste time triaging the same issue three times.

Story 2.2 — Request Clustering

As Priya, I want Dispatch to group related issues automatically
so I can understand themes (“onboarding friction,” “billing bugs”)
instead of drowning in individual tasks.

Story 2.3 — Suggested Merges

As Priya, when opening a new request,
I want Dispatch to show potential existing items
so I avoid creating more chaos.

⸻

3. Prioritization & Visibility

Story 3.1 — Founder Dashboard

As Frank, I want a simple dashboard showing:
	•	What users are asking for
	•	What engineering is doing
	•	What’s blocked
so I can feel informed without interrupting the team.

Story 3.2 — Priority Scoring

As Priya, I want Dispatch to propose priority scores
using metadata (customer, ARR, severity, pathway impact)
so I can quickly decide what matters.

Story 3.3 — SLA Alerts

As Support Sam, I want alerts when high-priority requests stagnate
so I can chase them before customers complain.

⸻

4. AI-Assisted Request Understanding

Story 4.1 — Summaries

As Erin, I want AI summaries on messy Slack threads
so I can instantly understand what the actual problem is.

Story 4.2 — Behavioral Context

(Zebric-powered)

As Priya, I want Dispatch to show which blueprint behaviors and code paths are affected
so I know how risky or impactful a change might be.

Story 4.3 — Intelligent Routing

As Support Sam, I want Dispatch to route items to the most relevant engineer or team
so we reduce hand-offs and confusion.

⸻

5. Status Sync Back to Linear / GitHub / Slack

Story 5.1 — Bi-Directional Sync with Linear

As Priya, when a Dispatch item moves to “planned,”
I want Linear to reflect the same status
so the backlog stays accurate.

Story 5.2 — GitHub PR Linking

As Erin, when I open a PR that solves a request,
I want Dispatch to automatically link it
so stakeholders see progress without asking.

Story 5.3 — Slack Notification on Resolution

As Support Sam, I want Slack to notify the original reporter
when an issue is resolved
so we close the feedback loop.

⸻

6. Lightweight Workflow + Triage

Story 6.1 — Inbox Zero-Style Triage Panel

As Priya, I want a triage view where I can
	•	accept
	•	tag
	•	assign
	•	merge
with keyboard shortcuts
so I can clear the daily flood of requests quickly.

Story 6.2 — Auto-Fill Metadata

As Priya, I want Dispatch to infer metadata (customer, type, category, severity)
so triage becomes “confirm the suggestions,” not “do all the grunt work.”

Story 6.3 — Quick Assign from Slack

As Erin, I want to assign a request directly from the Slack thread
so I don’t break flow.

⸻

7. Lightweight Roadmapping

Story 7.1 — Quarter Themes View

As Frank, I want a thematic roadmap built automatically from request clusters
so I can communicate vision during investor updates.

Story 7.2 — What’s Scheduled / What’s Not

As Priya, I want to mark requests as
	•	Committed
	•	Maybe
	•	Not now
so I can manage expectations.

Story 7.3 — Change History

As Priya, I want a log of priority changes and decisions
so I can explain “why this now and not that.”

⸻

8. Blueprint Integration (Zebric Advantage)

(This section differentiates Dispatch from Linear, GitHub, Jira, etc.)

Story 8.1 — Behavior-Level Impact

As Erin, I want requests mapped to blueprint behaviors
so I understand how code changes relate to human-defined behaviors.

Story 8.2 — Behavior Drift Alerts

As Priya, I want Dispatch to highlight when a request suggests that current behavior contradicts blueprint definitions
so we catch misalignment early.

Story 8.3 — Suggest Behavior Updates

As Dispatch, I want to propose updates to .zebric blueprints from request signals
so the system evolves automatically as the product grows.

⸻

9. Analytics & Insights

Story 9.1 — Fire Detection

As Frank, I want to see spikes in requests (Slack, GitHub, support inbox)
so I know when something is on fire before Twitter tells me.

Story 9.2 — Team Load Radar

As Priya, I want a load visualization of open requests per engineer
so I can balance work.

Story 9.3 — Customer Trends

As Support Sam, I want to see what customers complain about most frequently
so I can guide onboarding and support docs.

⸻

10. Low-Friction Adoption

Story 10.1 — Zero Setup Import

As Priya, I want to connect Linear, GitHub, Slack, and Notion in under five minutes
so I don’t burn time configuring a new tool.

Story 10.2 — No Forced Process Changes

As Erin, I want Dispatch to augment, not replace, my current GitHub/Linear workflow
so adoption feels natural.

Story 10.3 — Progressive Enhancement

As Frank, I want the team to gradually adopt Dispatch features
so we don’t overwhelm the startup.
