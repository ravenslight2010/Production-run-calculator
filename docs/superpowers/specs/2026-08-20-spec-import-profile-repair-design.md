# Spec import profile repair

## Goal

Spec-sheet re-imports must reliably correct existing pizza profiles. If an import
cannot persist every changed profile to the server, it must clearly fail rather
than appearing successful in the importing browser while the factory keeps old
data.

The repair also restores the setup fields explicitly supplied by the verified
August 19, 2026 spec imports and updates only unstarted current and future
scheduled-run snapshots.

## Scope and boundaries

- The latest saved parse for each profile in the August 19 import batch is the
  repair source of truth.
- Only fields explicitly present in a parsed profile are updated. Omitted
  fields retain their manager-controlled values.
- The correction applies to the factory profile and unstarted runs dated
  August 20, 2026 or later.
- Started and historical runs remain unchanged.
- The Corner Booth Pepperoni & Jalapeño setup and pending copies will use
  `Red Hot Pizza Sauce`, replacing `Mystic Pizza Sauce`.
- Parsing, prompts, and saved-parse hash behavior are out of scope. The saved
  parses have already been verified as correct.

## Design

### Import persistence

The spec-import confirmation flow will wait for the forced profile-sync queue
to receive a successful server acknowledgement for every profile it changed.
The result will distinguish success from a failed or unauthorized profile save.
Failed work remains available for retry rather than being silently removed.

The client will also refresh an open run form when its profile changes during
an import, preventing stale form values from overwriting the newly imported
setup during later navigation.

### One-time repair

A marker-guarded server data heal will run in one transaction. It will:

1. claim its stable marker before changing data;
2. read the latest applicable saved-spec parse for each affected profile;
3. apply only explicitly parsed profile fields to the matching live
   `brand_profiles` row, advancing its monotonic write stamp;
4. update the corresponding unstarted run values in today-and-future
   `daily_sync` rows, advancing their value stamps; and
5. leave unrelated profiles, omitted fields, started runs, and historical days
   untouched.

The heal is idempotent through its marker and uses row locks so concurrent
server boots cannot apply it twice.

## Error handling

- A rejected profile persistence request is surfaced to the importing manager
  with the affected-profile count and a retry action.
- No success message is shown until the server confirms every forced update.
- The one-time repair is transactional: a failure rolls back both profile and
  scheduled-run changes and does not keep the marker.

## Verification

- Unit tests cover forced profile sync success, rejection, retry, and
  multi-profile import persistence.
- Import tests confirm parsed profile fields overwrite bad stored values while
  parsed omissions preserve existing manager values.
- Data-heal tests cover idempotency, LWW stamps, and propagation only to
  unstarted current/future runs.
- The spec-import library and corpus regression suites run because import
  application behavior changes, even though parsing itself is unchanged.