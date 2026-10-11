# Sync top-level merge inventory

The sync API accepts the following persisted top-level fields. This inventory
describes the server behavior in `protectRunValues.ts`; it is not a JSON Patch
contract. A stale `baseSnapshotId` is rejected before these merge rules run.

| Merge behavior | Top-level fields | Rule |
|---|---|---|
| Protected per-run registers | `dayState`, `runValues`, `runValuesUpdatedAt`, `packagingProgress` | `dayState.runs` is unioned by run ID and removed only by run tombstones; run metadata uses strict-newer stamps. `dayState.prepPhase` merges its monotonic fields; `dayState.breaks` uses its bounded timestamp register. Reset/rollover has an explicit replacement boundary; other day-state fields come from the incoming section. Run values use strict-newer stamps unless the exact current snapshot was validated; blank-over-populated protection remains. Packaging progress uses correction generation then timestamp, preserves active server holds, and overlays its two counters into run values. |
| Additive registries | `brands`, `ingredientTypes`, `pepTypes`, `cheeseRecipeNames`, `mixRecipeNames`, `doughRecipeNames`, `frontlineRecipeNames`, `brandFlavors` | Name lists are unioned (case-insensitive for supported string lists); `brandFlavors` unions flavors per brand. Name deletion is represented by the stamp/tombstone maps, not omission. |
| Retained when omitted; explicit value replaces | `history` | Omission retains stored history; an explicit value, including an empty list, is authoritative. |
| Monotonic deletion state | `deletedItems`, `deletedStamps`, `undeletedStamps` | `deletedItems.runs` is unioned. Delete and undelete maps merge per name using the greatest positive stamp. |
| Per-entry timestamp merge | `doughTimerControls` | Entries merge by `updatedAt`; the server keeps its existing entry when the incoming timestamp is older. |
| Whole-section replacement when supplied | `templates`, `dieTypes`, `circles`, `shipper`, `skidStacking`, `gripSheets`, `cheeseIngredients`, `doughIngredients`, `frontlineIngredients`, `mixIngredients`, `doughRecipePresets`, `frontlineRecipePresets`, `cheeseRecipePresets`, `mixRecipePresets`, `brandProfiles`, `crustProfiles`, `mergedAway` | The incoming section is adopted as a whole. For these fields, the server does not perform a generic item-level merge. |

`syncVersion`, `completeness`, and `baseSnapshotId` are write-envelope fields,
not stored document sections. Unknown keys are stripped. `autoTrackCoordination`
and `autoTrackServerState` are server-maintained coordination state rather than
client-writable whitelist fields.

## Stale-write recovery

The client captures the canonical baseline alongside each queued write. A
current stale-base response or the documented legacy-upgrade `409` supplies
complete canonical data and a valid snapshot ID; only that explicit `409`
shape is recoverable. The client three-way-rebases the queued intent
(`baseline`, `intent`, `canonical`), then retries once using the returned
snapshot ID. Independent local changes are reapplied. Conflicting scalar
values remain server-owned, and bounded counts are shown in Sync Status
without logging payload values. If that retry races a second canonical change,
the client rebases again before any network retry; it never resends the same
stale complete snapshot. The baseline and intent are stored under the
authenticated scope and date so an initial canonical read after reload can
resume the same recovery.

Server timestamps remain defense in depth, not a substitute for snapshot
fencing: a client run-value stamp more than five minutes ahead of server time
gets no LWW weight on an unbased write. An exact current-base edit is instead
accepted by the snapshot fence and stamped with server time. Equal or older
stamps do not replace stored run values.
