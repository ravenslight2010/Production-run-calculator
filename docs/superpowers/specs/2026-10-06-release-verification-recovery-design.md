# Release Verification Recovery

**Date:** 2026-10-06
**Status:** Design approved; written-spec review pending

## Problem

The published build has an independently matched schema-v2 source handoff in
the workspace. The full browser report still has five failures: two schedule
move checks collide with a second alert, one visual baseline predates the
current allergen notice, and two sync/convergence cases need a valid isolated
rerun. The last rerun stopped at the published-build identity guard before
executing test cases.

Production reconciliation is separately authorized, but the supplied expected
database-owner identifier does not match the observed PostgreSQL catalog
owner. The capture must preserve that mismatch rather than imply a successful
owner check. Completion validation also encountered an SSH host whose key is
not verified by an available trusted source.

## Goals

- Preserve the published build's prepared-source record and schema-v2 handoff.
- Reproduce each browser failure on a disposable test database and fix only the
  demonstrated cause at its owning layer.
- Produce trustworthy browser evidence after the focused cases and full lane
  pass.
- Attempt the authorized read-only production reconciliation only through its
  existing manager-only endpoint, retaining a bounded, sanitized outcome.
- Keep unresolved owner or SSH trust checks visible; do not report a release
  pass when either blocks the relevant evidence.

## Non-goals

- Publishing, deploying, or changing the production database.
- Changing the PostgreSQL owner or substituting an unverified owner identity.
- Weakening assertions, bypassing build-identity guards, or changing browser
  inventory to make a filtered run look complete.
- Accepting an SSH host key without independent trusted verification.
- Unrelated applicator-stock, Chromium-inventory, or production configuration
  work.

## Approaches considered

### Selected: isolated, owner-layer recovery

Use a temporary local build identity for focused browser diagnosis while
backing up and restoring the published handoff and generated outputs. Scope
the two schedule-move alerts to their dialog. Update the visual baseline only
if the current allergen notice is confirmed as intentional and the fixture
state is correct. Change sync behavior only if the isolated cases reproduce
and identify a product defect.

This preserves the live build identity, server sync contracts, and existing
release evidence boundaries while limiting edits to confirmed causes.

### Rejected: relax tests or replace snapshots

Changing expectations or refreshing screenshots without confirming intended
UI and fixture state could conceal a real regression. Filtered diagnostic
runs are not full release evidence.

### Rejected: broad sync or browser-harness refactor

The current evidence does not justify redesigning sync transport, replacing
the release runner, or changing the full-suite inventory. Such changes would
increase regression risk without addressing a demonstrated cause.

## Design

### Build identity isolation

Before local browser builds, preserve the current source handoff and generated
web/API build outputs. Create a temporary candidate identity for the local
checkout, then use the existing focused Playwright configurations to reproduce
the failing cases. A cleanup trap restores the saved files on success,
failure, or interruption. Verify the original handoff and outputs after the
run. The temporary identity is diagnostic only and must not replace or be
described as the published build's source record.

### Browser failures

- Narrow schedule-move error assertions to the Scheduled Days dialog so the
  unrelated allergen alert cannot satisfy or break them.
- Keep the allergen notice and refresh its screenshot baseline only after
  verifying the UI is intentional and the screenshot fixture has the expected
  lifecycle state.
- Rerun the reload and reset/wake convergence cases in their isolated
  configurations. Compare browser state with canonical server state before
  classifying a mismatch as a product defect.
- If sync behavior changes, preserve reset epochs, stale-write rejection,
  adopt-before-publish ordering, canonical response adoption, and counter
  rebasing. Do not weaken assertions or add broad refactors.

After focused cases pass, run the full browser lane against a fresh disposable
database. Retained release evidence must come from the existing full release
runner; diagnostic filtered runs are not substitutes.

### Production reconciliation

Use the existing manager-only capture endpoint after confirming the fresh
schema-v2 handoff still matches the live build. The user has explicitly
authorized a temporary manager session for this capture; sign-in is paired
with sign-out in a `finally` path. The endpoint's production transaction
remains read-only and bounded.

Supply the operator-provided expected database owner without echoing or
retaining it. If the catalog check disagrees, retain only the endpoint's
bounded failure outcome. Do not change ownership, modify production records,
or classify the capture as passing evidence. If preflight rejects the
request, retain only a sanitized reason and stop.

### SSH trust boundary

Do not disable strict host checking, append an unknown fingerprint, or
otherwise bypass SSH verification. If managed task completion requires a
trusted host key that is unavailable, report the blocker and request trusted
Replit Git-link repair or independently verified fingerprint information.

## Error handling and cleanup

- A failure before tests execute is a harness/build-identity failure, not a
  browser assertion failure.
- Always restore the saved handoff and build outputs, and verify their
  identities afterward.
- Always attempt manager sign-out after a production capture attempt. Do not
  write session tokens, request bodies, owner identifiers, raw response
  payloads, production rows, or credentials to logs or retained evidence.
- Retain only evidence needed to establish environment, live build identity,
  test outcome, bounded counts, and unresolved checks.
- Do not claim complete release verification while the owner check or SSH
  trust boundary remains unresolved.

## Validation

1. Confirm the current published source handoff remains schema-v2 and matches
   the live build after local test cleanup.
2. Run the focused schedule-move, reload/convergence, reset/wake, and visual
   cases with existing isolated Playwright configurations.
3. For a confirmed sync change, run the applicable API reset/session-boundary
   integration tests and focused client sync tests. If the change crosses
   timer, counter, pause/resume, or wake-rebase behavior, run the corresponding
   state-accuracy checks as well.
4. Run the full browser release lane on a fresh disposable database and retain
   evidence only through the configured release runner.
5. Attempt the authorized production capture only after live build/handoff
   preflight. Record a bounded failure accurately if the database-owner check
   does not pass.
6. Verify cleanup, `git diff --check`, and the final changed-file set.

## Acceptance criteria

- The published source record and its fresh schema-v2 handoff remain intact.
- Each of the five known browser failures is either corrected at its owning
  layer and passes, or has a bounded, evidence-backed explanation showing why
  it is not a product regression.
- The full browser release lane passes before its evidence is called complete.
- Production capture evidence, if returned, is sanitized and accurately
  reports the owner check; a mismatch is not a release pass.
- No production data or ownership is changed, no unknown SSH key is trusted,
  and unresolved external blockers are stated explicitly.
