# Idea to Operations contributor guidance

This example models an organizational lifecycle shared by humans and agents. It
is also a Zebric framework stress test.

- Keep entities, authorization, lifecycle rules and automation in `blueprint.toml`
  when Zebric can express them. Document what it cannot in `ZEBRIC_GAPS.md`
  instead of adding TypeScript. Do not add example-specific branches to framework
  packages.
- Initiative `stage` changes only through the named workflows. Never add a form,
  skill action, or convenience route that writes `stage`, `health` decisions,
  decision `status`/`outcome`, or readiness/milestone completion directly.
- Agents prepare; humans authorize. Do not add skill actions for
  `RecordDecision`, `ApproveInitiative`, `ApproveLaunch`, `RetireCapability`, or
  anything that moves a stage. Agent write tools must be workflows that name the
  fields they set (G-08), never raw `create` actions.
- Put every static check in a workflow `precondition` so it refuses
  synchronously; assert dynamic prerequisites with the find + conflict pattern
  used in `RequestLaunchReview` and `ApproveLaunch` (G-02, G-05).
- Always send every payload key from forms (unresolved template references are
  stored literally, G-09), and guard required text with `{ "$gt" = "" }`.
- Record an `Activity` row from every command, and keep tasks/milestones modest:
  this is not a project-management product.
- Run `scenarios/lifecycle-smoke.sh` after changing a workflow, role, or access
  rule, on a freshly seeded database with `ZEBRIC_RATE_LIMIT_MAX` raised.
