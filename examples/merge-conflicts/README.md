# Merge Conflict Workflow

This example is an executable, policy-driven merge-conflict resolution workflow. Zebric owns the state and review records; classifiers and agents only return bounded structured data. The primary tests create temporary repositories and exercise real `git merge` conflicts.

## What is implemented

- A repository boundary with real local-Git and GitHub-backed adapters
- Three-way conflict inspection from Git index stages (`:1`, `:2`, and `:3`)
- A deterministic classifier plus a narrow adapter boundary for TypeSafe.ai Jev
- Deterministic import, formatting, and additive resolvers
- A bounded agent interface with prior failed attempts supplied as evidence
- Deterministic validation for unmerged paths, conflict markers, `git diff --check`, and repository commands
- Risk policy, explicit approval/rejection, publishing, and structured audit events
- Twelve documented fixture expectations and real-Git integration tests
- A Zebric blueprint for durable domain, evidence, and human review records

## Run it

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter merge-conflicts test
pnpm --filter merge-conflicts build
```

To inspect the Zebric review console:

```bash
pnpm --filter merge-conflicts dev
```

Then open <http://localhost:3012>. The console is intentionally separate from the TypeScript runner today; the missing typed example-action bridge is documented in `ZEBRIC_GAPS.md`.

## Integrating an agent

Implement `ResolutionAgent.propose`. The workflow supplies only pull-request metadata, one file's base/ours/theirs content, classification, bounded Git history, and previous attempts. A proposal contains complete resolved content, an explanation, assumptions, and a human-review flag. It cannot mark the workflow successful.

## Integrating Jev

Construct `JevClassifier` with an inference callback that maps Jev output into the example taxonomy. Jev is optional because this repository does not currently carry a supported Jev client or model artifact. The deterministic classifier makes local tests repeatable; policy never depends on a model controlling workflow transitions.

## GitHub path

`GitHubRepositoryAdapter` maps PR metadata through a small `GitHubClient`, while conflict inspection and validation operate on a real prepared clone. Publishing is disabled unless the caller explicitly supplies a push function. Credentials therefore remain in the host integration and are never stored by the example.

The caller is responsible for cloning/fetching the PR, checking out a resolution branch, and starting the merge that produces the conflicted index. A dedicated fixture repository is recommended.

## Safety notes

- Candidate paths are constrained to the configured worktree.
- Validation commands are trusted repository configuration and run through `/bin/sh`; never accept them from an untrusted PR payload.
- Automatic publishing can be disabled with `autoPublish: false`.
- High/unknown risk, unknown classification, explicit model concern, and exhausted retries all require human review.
