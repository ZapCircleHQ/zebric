Zebric Merge Conflict Workflow Example

Objective

Build a new Zebric example demonstrating a realistic merge-conflict resolution workflow involving:

* deterministic workflow steps,
* classifier/model-driven decisions,
* LLM agent reasoning,
* deterministic validation,
* human-in-the-loop decisions,
* external system integration,
* auditable workflow state.

The example should ultimately be capable of operating against a real GitHub repository, but its primary automated test environment should use controlled local/mock repositories.

This is a dogfooding exercise for Zebric 0.5.x.

Success means both:

1. building the best merge-conflict workflow possible using Zebric as it exists today; and
2. identifying framework limitations encountered while building it.

A required output of this work is therefore:

ZEBRIC_GAPS.md

Do not hide framework limitations with example-specific hacks merely to make the demo appear complete.

⸻

Critical Constraint: Do Not Modify Zebric Core

Do not make changes to Zebric framework/package code as part of this task.

Treat the existing Zebric version as an external framework dependency.

All new implementation must live within the merge-conflict example.

In particular, do not add domain knowledge about any of the following to Zebric packages:

* Git
* GitHub
* repositories
* branches
* commits
* pull requests
* merge conflicts
* conflict resolution
* Jev
* GitHub authentication
* GitHub APIs

These concepts belong to the example.

Even if some code appears potentially reusable, keep it local to the example for now.

If the example requires functionality Zebric does not currently provide, document that requirement in ZEBRIC_GAPS.md.

Do not modify Zebric itself to solve the gap.

A framework limitation discovered during this exercise is a useful result.

⸻

Architectural Principle

The example should demonstrate this division of responsibility:

Zebric owns the workflow. Models perform bounded tasks within the workflow.

The LLM should not independently orchestrate the entire merge-conflict process.

Similarly, classifiers should provide structured information to the workflow rather than deciding what the workflow does.

The intended architecture is approximately:

Git/GitHub event
      │
      ▼
Deterministic inspection
      │
      ▼
Conflict classification
      │
      ▼
Workflow policy
   ┌──┴───────────────┐
   │                  │
   ▼                  ▼
Deterministic      Agent
resolution         reasoning
   │                  │
   └───────┬──────────┘
           ▼
   Apply candidate
           │
           ▼
Deterministic validation
           │
      ┌────┴─────┐
      │          │
    PASS        FAIL
      │          │
      ▼          └── retry/escalate
 Policy gate
      │
 ┌────┴────┐
 │         │
 ▼         ▼
publish   human review

This separation should remain visible in the implementation.

⸻

Repository Integration Boundary

Do not tightly couple the workflow itself to GitHub.

Create an example-local repository abstraction capable of supporting at least:

* retrieving repository/PR metadata,
* retrieving conflicted files,
* obtaining base/ours/theirs versions,
* inspecting relevant history,
* applying a candidate resolution,
* running validation,
* publishing a completed resolution.

The exact API should emerge from implementation needs rather than being prematurely generalized.

There should eventually be at least two implementations:

Repository Adapter
       │
   ┌───┴────┐
   │        │
Local Git  GitHub

The local implementation is the primary testing environment.

The GitHub implementation proves that the workflow can operate against a real repository.

Do not move this abstraction into Zebric core.

⸻

Local Git Test Environment

Mock GitHub where useful, but do not mock Git itself unnecessarily.

Tests should create real temporary Git repositories containing controlled branches and commits.

For example:

base
 ├── main
 │    └── change A
 │
 └── feature
      └── change B

The test can then perform an actual Git operation that produces a conflict.

The workflow should inspect and resolve the resulting real Git state.

This gives us deterministic, repeatable fixtures without depending on GitHub availability.

The distinction is:

Mock GitHub. Exercise real Git.

⸻

Initial Domain Model

Start with a minimal model rather than reproducing GitHub.

Likely entities include:

Repository

Configuration for a repository participating in the workflow.

PullRequest

The external pull request identity and relevant synchronized state.

ConflictResolution

One execution of the conflict-resolution workflow.

Possible state progression:

detected
   ↓
analyzing
   ↓
ready
   ↓
resolving
   ↓
validating
   ├──── failed ────→ resolving
   ↓
awaiting_approval
   ├──── rejected ──→ resolving
   ↓
approved
   ↓
applying
   ↓
completed

Active states should also have an appropriate failure/abandonment path.

ConflictFile

Represents an individual conflicted file and its classification.

ResolutionAttempt

Represents a candidate resolution, including:

* source/model,
* proposed patch,
* explanation,
* assumptions,
* validation result,
* timestamps.

Prefer Zebric’s framework workflow/audit facilities for authoritative execution history rather than inventing an example-specific workflow log.

If this is not possible, record the limitation in ZEBRIC_GAPS.md.

⸻

Conflict Classification

We want to investigate incorporating TypeSafe.ai’s Jev model as the classification stage.

Keep classification separate from resolution.

The classifier should receive bounded conflict information and return structured output.

An initial taxonomy might be:

IMPORTS
FORMATTING
ADDITIVE
GENERATED
DEPENDENCY
IMPLEMENTATION
TEST
CONFIGURATION
DOCUMENTATION
UNKNOWN

A separate risk classification may be useful:

LOW
MEDIUM
HIGH
UNKNOWN

Do not assume this taxonomy is correct. Refine it based on implementation experience.

The important architectural rule is:

Classification produces data. Zebric workflow policy determines what happens next.

For example:

IMPORTS + LOW
    → deterministic resolver if available
GENERATED
    → regenerate if supported
IMPLEMENTATION + LOW/MEDIUM
    → agent proposes resolution
IMPLEMENTATION + HIGH
    → agent may propose, but human approval required
UNKNOWN
    → human review

Investigate Jev as a first-class implementation of this classifier.

If Jev integration is impractical, incomplete, or exposes a missing Zebric capability, document this rather than hiding it.

⸻

Agent Resolution

The coding agent/LLM used by the workflow should receive bounded context.

Useful context may include:

* base version,
* ours,
* theirs,
* nearby source,
* relevant commits,
* PR descriptions,
* tests,
* repository instructions,
* previous failed attempts.

The agent should return structured output approximately equivalent to:

{
  "patch": "...",
  "explanation": "...",
  "assumptions": [],
  "requiresHumanReview": false
}

The exact schema may evolve.

The model must not directly declare the workflow successful.

Its proposal becomes input to subsequent deterministic workflow steps.

⸻

Deterministic Validation

Candidate resolutions should be validated outside the LLM.

Depending on the fixture/repository, validation may include:

* no remaining conflict markers,
* valid Git state,
* formatter,
* linter,
* type checker,
* compilation/build,
* unit tests,
* repository-specific validation commands.

Failed validation should become structured workflow evidence.

Where appropriate, a failed attempt may be supplied to another resolution attempt.

Retries must be bounded.

Repeated failure should result in escalation rather than an infinite agent loop.

⸻

Human-in-the-Loop

Some conflicts should deliberately require human involvement.

Human review is not a failure mode.

It is an intended workflow outcome.

A reviewer should be able to inspect at least:

* conflict,
* classification,
* risk,
* proposed resolution,
* model explanation,
* assumptions,
* validation results,
* previous attempts.

The reviewer should be able to approve, reject, or request/revise another attempt as supported by Zebric.

Authorization should use existing Zebric mechanisms.

If the desired authorization semantics cannot be represented, record this in ZEBRIC_GAPS.md.

Do not modify Zebric authorization code.

⸻

Fixture Suite

Create a controlled fixture suite rather than relying entirely on arbitrary real-world conflicts.

Aim initially for approximately 8–15 cases covering different behaviors.

Useful fixtures include:

1. duplicate import,
2. import ordering,
3. independent additive changes,
4. documentation conflict,
5. dependency/version conflict,
6. generated-file conflict,
7. configuration conflict,
8. same-function implementation conflict,
9. conflicting business rules,
10. conflicting test expectations,
11. ambiguous intent,
12. unsupported/unrecognized conflict.

Each fixture should define its expected workflow behavior.

For example:

fixture
   ↓
expected classification
   ↓
expected workflow route
   ↓
expected resolver
   ↓
expected validation
   ↓
expected human involvement
   ↓
expected final Git state

Do not optimize for 100% autonomous resolution.

Correctly identifying that a human should make a decision is a successful result.

⸻

Real GitHub Integration

After the workflow works against local repositories, add an integration path for an actual GitHub repository.

Prefer a dedicated test/fixture repository rather than depending on arbitrary production repositories.

The GitHub layer should translate external GitHub concepts into the example’s repository abstraction.

Keep GitHub API details out of the core workflow where practical.

Credentials must use appropriate secrets/configuration handling and must never be committed.

If Zebric lacks an appropriate mechanism, document that in ZEBRIC_GAPS.md.

⸻

Auditability

One purpose of this example is demonstrating that agentic workflows can be understandable after execution.

For a resolution, we should ideally be able to answer:

* What triggered this workflow?
* What files conflicted?
* What did the classifier decide?
* What classifier/model/version was used?
* What policy path was selected?
* Was an LLM invoked?
* What context was supplied?
* What did it propose?
* What deterministic validations ran?
* What failed?
* Were retries performed?
* Did a human intervene?
* Who approved the resolution?
* What mutation was ultimately made?
* What commit resulted?

Use existing Zebric workflow and audit capabilities wherever possible.

Do not build a large parallel audit framework simply to make the example work.

Missing audit/query capabilities belong in ZEBRIC_GAPS.md.

⸻

ZEBRIC_GAPS.md — Required Deliverable

ZEBRIC_GAPS.md is a required output of this exercise and should be maintained while implementing the example.

Do not wait until implementation is complete and reconstruct the gaps from memory.

Each gap should contain enough information for us to make a later framework design decision.

Use approximately this structure:

# Zebric gaps found while building Merge Conflict Workflow
## Gap summary
| Priority | Gap | Workflow consequence | Possible direction |
|---|---|---|---|
## GAP-001: Short descriptive name
### Desired behavior
What the workflow needs to express.
### Current Zebric behavior
What Zebric currently supports.
### Consequence
What becomes impossible, awkward, unsafe, or overly example-specific.
### Example
A concrete case encountered while implementing this workflow.
### Workaround used
Describe any example-local workaround.
If no reasonable workaround exists, say so.
### Possible framework direction
Describe the capability that might address the problem.
Do not implement it in Zebric as part of this task.

Priorities should reflect impact:

P0 — prevents correct or safe implementation.

P1 — major limitation requiring significant workaround or loss of important semantics.

P2 — meaningful ergonomics/composability issue.

P3 — polish or developer-experience improvement.

Do not inflate priorities merely because something is inconvenient.

⸻

What Counts as a Zebric Gap?

Record gaps when the desired behavior is reasonably generic to agentic/business workflow applications rather than peculiar to GitHub.

Examples might include:

* workflow-only/domain-command mutations,
* typed model steps,
* structured model outputs,
* workflow expressions,
* access to previous step outputs,
* bounded retries,
* human approval primitives,
* contextual authorization,
* external action/plugin interfaces,
* secret management,
* durable long-running workflows,
* artifact storage,
* event triggers,
* model provenance,
* workflow audit querying,
* JS/TS escape hatches,
* compensation/failure handling.

These are examples, not predetermined conclusions.

Only record gaps actually encountered.

Conversely:

“Zebric doesn’t understand pull requests”

is not a gap.

Zebric should not understand pull requests.

A more legitimate gap might be:

“A workflow cannot invoke an example-defined external action and consume its typed result.”

That is framework-level.

This distinction is central to the exercise.

⸻

Avoid Premature Framework Design

When a gap is discovered:

1. Record the desired behavior.
2. Record what Zebric currently does.
3. Try a reasonable example-local implementation.
4. Document the consequences.
5. Continue building where possible.

Do not immediately design a generalized Zebric subsystem.

We want evidence from multiple dogfooding applications before promoting abstractions into the framework.

Dispatch and the other Zebric examples may expose related requirements differently.

The gap ledger should preserve that evidence.

⸻

Example-Local Workarounds Are Allowed

A workaround is acceptable when it allows us to continue learning.

However, clearly label it.

For example:

// ZEBRIC_GAP: Workflow cannot currently invoke a typed
// example-defined action directly. This adapter is local to
// the merge-conflict example. See ZEBRIC_GAPS.md GAP-004.

Prefer comments that reference the corresponding gap.

Do not disguise workarounds as intended architecture.

⸻

Expected Outputs

The completed work should include, at minimum:

merge-conflict-workflow/
├── README.md
├── MERGE_CONFLICT_WORKFLOW.md
├── ZEBRIC_GAPS.md
├── <Zebric blueprint/configuration>
├── <example-local actions>
├── <repository adapters>
├── <classification integration>
├── <agent integration>
├── fixtures/
└── tests/

Follow existing repository conventions where they differ from this illustrative structure.

README.md should explain how to run the example.

MERGE_CONFLICT_WORKFLOW.md should document the resulting workflow architecture and important design decisions.

ZEBRIC_GAPS.md should contain the framework findings.

⸻

Acceptance Criteria

The example is successful when:

* Zebric core/packages have not been modified.
* Zebric contains no new GitHub/PR/merge-conflict domain knowledge.
* A real local Git repository can be placed into a controlled conflict state.
* Zebric orchestrates the conflict-resolution workflow.
* Deterministic steps are clearly distinguishable from model-driven steps.
* Conflict classification produces structured data.
* Jev has been investigated as the classifier implementation.
* At least some conflicts use an LLM/agent for proposed resolution.
* Proposed resolutions undergo deterministic validation.
* At least one fixture requires human review.
* Retries/failures are bounded and observable.
* Workflow activity is auditable using Zebric facilities as far as currently possible.
* The same conceptual workflow can operate through the GitHub adapter.
* Tests cover multiple conflict categories and workflow routes.
* ZEBRIC_GAPS.md documents limitations discovered during implementation.

Most importantly:

Do not judge success by whether every desired feature works.

If the implementation reaches a point where Zebric cannot cleanly express an important part of this workflow, that is a valuable dogfooding result.

Document it precisely, use an example-local workaround where reasonable, and continue.

The goal is to learn what an agentic application framework needs by building a real agentic workflow on top of Zebric—not by modifying Zebric until the example passes.