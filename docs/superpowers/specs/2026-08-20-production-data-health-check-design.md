# Production Data Health Check

## Context

The August 19 spec re-import left some saved profiles incomplete or linked to
the wrong named recipe even though the import appeared to finish. A
marker-guarded repair corrected the known production data, and import
regression coverage now protects the normal commit path. This design adds a
repeatable production check that can detect similar stored-data drift and
repair only cases with an unambiguous source of truth.

## Goals

- Give managers a clear view of profile and recipe integrity problems.
- Repair deterministic, safe cases without requiring a manual database edit.
- Prevent repairs from changing started or historical run snapshots.
- Make every repair transactional, idempotent, timestamped, and auditable.
- Leave ambiguous cases visible for manual review instead of guessing.

## Non-goals

- Changing AI parsing, model routing, or workbook contents.
- Re-running the August 19 production repair.
- Automatically choosing between multiple possible recipe matches.
- Repairing started or historical runs.
- Adding scheduled background execution in the first version.

## Recommended architecture

Add a manager-authorized data-health endpoint that runs a read-only detector
and returns a structured report. Add a separate manager-authorized repair
action that accepts only detector-produced repair IDs, revalidates each repair
inside one transaction, and applies the safe subset.

Keep detection and repair separate so opening the report never changes data.
The repair action should return counts and per-item outcomes:

- `repaired`: deterministic repair applied.
- `already-healthy`: no change was needed when revalidated.
- `needs-review`: ambiguity or missing authority prevented repair.
- `failed`: the transaction or required write failed and must not be reported
  as repaired.

Use existing manager capability checks and audit-log conventions. Do not add a
new database table unless the existing audit/data-heal records cannot preserve
the required repair history.

## Detection rules

The first version should inspect:

1. Brand profiles whose selected dough or sauce name does not resolve to a
   current named-recipe pool entry.
2. Profiles whose saved recipe rows are absent when the authoritative source
   says rows should exist.
3. Unstarted and future run snapshots whose setup disagrees with their source
   profile after a profile repair.
4. Recipe links whose name and resolved recipe content disagree with a
   matching saved import parse.

Started and historical runs may be reported for visibility, but must never be
included in automatic repair candidates.

Each candidate must carry enough source information for repair to revalidate
it: profile identity, current value fingerprint, authoritative source
fingerprint, and the reason it qualifies. The detector must not create a
repair candidate from a fuzzy match alone.

## Safe repair rules

A repair is eligible only when all of these are true:

- There is exactly one authoritative source, such as the latest applicable
  saved parse or an exact named-recipe match.
- The current stored value still matches the fingerprint observed during
  detection.
- The repair does not touch a started or historical run.
- Required recipe rows and linked pool data are available and internally
  consistent.
- The repair can advance the profile or sync LWW timestamp monotonically.

If any condition fails, return `needs-review` and make no partial change.

Apply profile and associated recipe changes in one transaction. Advance
profile timestamps using the existing monotonic LWW rule so a stale open
device cannot republish the bad value. Fan out only to unstarted current or
future snapshots using the existing profile propagation rules.

Repairs must be idempotent: running the same repair again should return
`already-healthy` and must not create duplicate pool rows, duplicate audit
events, or additional semantic changes.

## Data flow

1. A manager opens the health view.
2. The client requests a no-write report.
3. The server derives findings and safe repair candidates from current pool,
   profile, saved-parse, and run data.
4. The manager reviews counts and candidate details.
5. The client submits selected safe repair IDs.
6. The server re-reads and revalidates each candidate in a transaction.
7. The server applies only still-valid deterministic repairs.
8. The response reports repaired, already-healthy, needs-review, and failed
   outcomes.
9. The client refreshes profile/run data and displays the audit result.

## Error handling and concurrency

- A failed required write aborts the transaction and is reported as failed;
  it must never be counted as successful.
- A changed fingerprint means another device modified the record; return
  needs-review rather than overwriting the newer value.
- Authorization failures remain manager-only and return the normal API error
  shape.
- Large reports should be bounded and paginated or summarized if needed.
- The detector should tolerate a missing optional saved-parse source by
  reporting the finding as needs-review, not by guessing.

## Alternatives considered

### Startup-only boot heal

This is simple and follows the existing one-time heal pattern, but it only
handles known incidents and gives managers no visibility into newly-created
drift. It is not recommended as the primary design.

### Automatic scheduled repair

This could catch problems without manager action, but it increases the risk of
repeating a bad repair and makes ambiguous cases harder to review. It can be
added later after the on-demand report and repair path has proven reliable.

### Report-only audit

This is safest but leaves managers to manually correct known deterministic
issues. Because the user approved safe automatic repair, this is insufficient
on its own.

## Testing plan

- Unit-test each detector rule with healthy, missing, ambiguous, and stale
  records.
- Test that exact authoritative matches repair while fuzzy or multi-match
  cases remain untouched.
- Test transaction rollback when a profile, recipe, or propagation write fails.
- Test fingerprint and LWW protections against a concurrent newer edit.
- Test that started and historical runs are never changed.
- Test repeated repair requests for idempotency.
- Test the manager authorization boundary and normal error responses.
- Add an integration fixture representing the August 19 failure shape,
  including a profile linked to the wrong sauce and a required pull
  ingredient.
- Run the focused data-health tests, API integration tests, client tests, and
  typechecking before publishing.

## Approval boundary

This document describes the approved design only. Implementation should begin
after the user reviews this written specification and confirms that the
architecture and safety rules are correct.