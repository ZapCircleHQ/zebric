# Resulting merge-conflict workflow

This document records the architecture implemented from `MERGE_CONFLICTS_WORKFLOW.md`.

## Control flow

1. The repository adapter returns PR metadata and reads real unmerged Git index stages.
2. The classifier returns `{ kind, risk, classifier, modelVersion, reasons }` for each file.
3. Workflow policy selects a deterministic resolver for low-risk imports, formatting, and append-only changes. Other supported text conflicts go to the bounded agent.
4. Every candidate is written and staged, then deterministic checks run. An agent never controls validation or success.
5. Failed agent candidates are supplied to the next attempt. The attempt count is bounded (two by default).
6. High/unknown risk, unknown conflicts, an agent review flag, exhausted retries, or disabled auto-publish creates an approval outcome.
7. Approval publishes a commit; rejection abandons the resolution. Both decisions are audited with reviewer identity.

All files are processed before the approval gate so multi-file conflicts can be reviewed as one unit. Candidate checks are scoped to the file being attempted; repository-wide markers, Git state, and configured commands are checked again immediately before publication.

## Responsibility boundaries

`RepositoryAdapter` contains repository mechanics. `LocalGitRepositoryAdapter` is the reference implementation and is exercised against temporary repositories. `GitHubRepositoryAdapter` translates GitHub metadata and publication, while delegating Git operations to a real clone.

`ConflictClassifier` only describes the conflict. `HeuristicClassifier` is deterministic and testable offline; `JevClassifier` accepts a narrow inference callback so a future Jev runtime can be introduced without changing policy.

`ResolutionAgent` proposes complete file content and evidence. It receives no repository mutation or publishing capability.

`MergeConflictWorkflow` alone owns routing, retry limits, validation gates, approval policy, state transitions, and publication.

## Audit evidence

The example emits events for detection, inspected paths, classifier output and provenance, agent invocation context, proposal and validation evidence, approval decisions, failure, and the published commit. `MemoryAuditSink` is used by tests. The blueprint models durable resolution, conflict, attempt, and review records.

The TypeScript workflow and Zebric persistence console cannot yet be connected as one native typed workflow. This is kept visible and recorded as GAP-001 rather than hidden behind a custom server.

## Fixture strategy

`fixtures/catalog.ts` declares twelve expected routes. Integration tests create actual repositories, diverging commits, and actual conflicted Git indexes. GitHub metadata is mocked at the integration boundary; Git itself is not mocked.

## Known scope boundaries

- The example resolves text files. Binary/submodule conflicts should classify as unknown in a future content-aware classifier and go to review.
- Generated files currently go to review because no repository-specific regeneration action is configured.
- A complete GitHub host should verify webhook signatures, prepare an isolated clone, supply credentials, and clean it up.
- Candidate rollback is unnecessary for the current whole-file proposal loop because each attempt overwrites and stages the same path. Multi-file atomic rollback remains a future hardening item.
