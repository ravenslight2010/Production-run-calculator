---
name: Move scheduled runs
description: Move a whole scheduled day or a single scheduled run to another date; shared pure merge lib, web/mobile pool asymmetry, and why web per-run move must use run id not index.
---

# Move scheduled runs

Users can re-date the SCHEDULE pool freely (whole day or single run) but the live
"today's runs" list is NEVER a move source or target.

## Pool asymmetry (intentional, architecture-driven)

- **Web pool = FUTURE days only** (`date > today`). Web's `today` server row IS the
  live runs, so the date picker `min` is tomorrow and today is never offered.
- **Mobile pool = today + future.** Mobile `scheduled` is a LOCAL-only
  `Record<date, ScheduledRun[]>` in AsyncStorage where the today bucket is a
  distinct thing from the live `runs` list, so re-dating it is safe.
- This is not a parity bug — it falls out of the storage model. Keep it.

## Shared merge lib `@workspace/schedule-move`

`moveEntries(source, target, ids|"all", genId) → {source, target, idMap}`:
appends moved entries to target (NO auto-collapse by brand+flavor), regenerates
ids that collide with existing target ids (reports the remap in `idMap`),
preserves all entry fields (incl. `imported`). Caller deletes the source day if it
becomes empty. `relocateValues(srcVals, tgtVals, idMap)` moves the web `runValues`
map alongside, applying the id remap. Both apps call the identical lib.

## Web per-run move must key on run id, NOT list index

The schedule list view runs come from `/api/sync/scheduled?include=runs`. That route
now additively returns each run's `id` (ad-hoc JSON route, not spec-validated — safe
to extend). The UI stores `{from, runId}` and `performScheduleMove` resolves the run
by id in the refetched source payload.

**Why:** an earlier version stored a `runIndex` and resolved
`src.dayState.runs[runIndex]` at confirm time. If the day was edited/imported/reordered
between opening the picker and confirming, the index pointed at the wrong run (or
none) and moved the wrong one. Always carry the stable id.

## Failure-mode ordering (web)

`performScheduleMove` writes the TARGET day first, then trims/deletes the source.
A partial network failure can therefore only leave a visible, user-fixable
**duplicate** — never lose runs. Accepted tradeoff over a new atomic server endpoint
(the rest of the app is client-orchestrated multi-PUT too). Target/source PUTs
preserve the other payload fields (`base = existing payload`) so master-data isn't
clobbered.

## Notes

- No DB/OpenAPI changes; web reuses existing `/api/sync/:date` GET/PUT/DELETE.
- Mobile move is plain AsyncStorage persist (not synced → no deletion tombstones).
- Lib tests live in `lib/schedule-move/src/index.test.ts`; run via
  `pnpm --filter @workspace/schedule-move run test` (no dedicated workflow — the
  10-workflow cap was already full).
