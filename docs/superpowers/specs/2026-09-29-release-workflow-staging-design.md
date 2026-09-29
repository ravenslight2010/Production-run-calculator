# Release Workflow Staging

## What & Why
The `Project` run button currently starts seventeen independent validation and release workflows in parallel. This includes overlapping package checks, standard and full release suites, and a separate full-browser run. The September 29 run log shows worker/thread creation failures (`EAGAIN`, `Cannot fork`, and PostgreSQL startup failure) across unrelated suites, so the run fails before producing trustworthy full-release evidence.

Use the existing release orchestrator as the single default entry point. Keep the full release suite as an explicit action, and retain focused validation workflows for targeted work. This reduces duplicate work and resource exhaustion without removing release gates or lowering test coverage.

## Design
- Keep the `Project` run button, but have its workflow launch only the existing `release:standard` workflow.
- Keep `release:full` available as a separate, deliberate run for full browser/release verification after standard checks pass.
- Keep individual package, typecheck, security, clean-start, evidence, and browser workflows available for manual focused runs; do not include them as parallel children of `Project`.
- Leave gate definitions, assertions, timeouts, evidence contracts, and per-step concurrency limits unchanged. The release orchestrator remains responsible for dependency ordering and bounded step concurrency.
- Add a lightweight workflow-configuration check for the `Project` entry point if it can use the existing test infrastructure without introducing a new runtime dependency.

## Behavior and Failure Handling
- A normal `Project` run executes the standard release plan once and reports gate outcomes through the existing release runner.
- A full release remains explicit and runs the full release plan once; the standalone `browser-full-159` workflow stays available for focused browser diagnosis, not as a duplicate of the default run.
- If a release gate still fails to spawn workers when run through the orchestrator, report it as an environment/resource failure and retain the existing incomplete-evidence behavior. Do not convert resource failures into passes or reuse stale retained evidence.

## Validation
- Parse the workflow configuration and assert that `Project` has exactly one child, `release:standard`.
- Confirm `release:full` and the focused validation workflows remain individually configured.
- Run the lightweight workflow-configuration check and existing workflow validation only; do not start all validation workflows together.
- Do not rerun the full release suite solely to verify the `.replit` task topology.

## Out of Scope
- Removing or weakening any release gate, reducing the browser case inventory, or changing test assertions.
- Increasing worker limits to compensate for parallel oversubscription.
- Reorganizing the release orchestrator's stage/dependency model or changing retained-evidence semantics.
- Publishing the app or treating standard checks as full release approval.