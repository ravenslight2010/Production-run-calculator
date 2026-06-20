---
name: Merge deny + master-data change history
description: How "ignore AI merge suggestion" and the local master-data undo trail work across web+mobile.
---

# Merge-suggestion deny + master-data change history

Two related features, both web+mobile parity.

## Deny / ignore merge suggestions
- A denied pair is FACTORY-WIDE and server-persisted (mirrors `merge_aliases`): table `denied_merges` stores an unordered `{nameA,nameB}` pair (sorted + lowercased key).
- Pure helpers live in `lib/merge-suggest`: `deniedPairKey`, `collectDeniedPairs(target, sources)`, `filterDeniedSuggestions(suggestions, denied)`.
- The filter is applied at the SINGLE shared client glue point (`mergeSuggest.ts` in each app) that combines learned + AI suggestions — and also on the remembered-only fallback path, so denied pairs never reappear regardless of AI availability.
- `denyMerge(target, sources)` POSTs the collected pairs, then drops the suggestion locally.

## Master-data change history (LOCAL, NOT synced)
- **Why local:** day-state sync payload already brushes the 10mb body limit; history snapshots would blow it. So history is per-device only.
- Web: new localStorage key (`CHANGE_HISTORY_KEY`). Mobile: new AppState field `changeHistory`.
- **Mobile sync exclusion is structural, not a filter:** `sync/mapping.ts` `SyncableState` simply doesn't include `changeHistory`; `appStateToPayload`/`applyPayloadToState` only touch mapped fields, and remote apply is `{...prev, ...patch}` so local history survives pulls and is never uploaded. `buildNextDayState` spreads `...cur` so it survives day rollover too.
- Capped to last `MAX_CHANGE_HISTORY = 20` entries (quota-safe).
- Entry: `{ id, ts, type: merge|add|remove|rename, description, before: snapshot }`. Snapshot = full state MINUS `changeHistory` (mobile: `Omit<AppState,"changeHistory">`).
- **Undo is rollback-to-point:** restoring entry at index `idx` restores `list[idx].before` and trims history to `list.slice(idx+1)` (older entries only) — so it reverts that change AND every change made after it.
- Instrument changes via a no-op-safe wrapper (mobile `withChangeRecord`, JSON-compares before/after and records nothing if identical) on every master-data mutator (list add/remove/rename, brand/flavor rename, recipe preset rename/delete, mergeIngredients).

## Merge-undo caveat (both platforms warn)
Undoing a change whose rolled-back range includes a `merge` reverses the NAMES and LISTS, but does NOT un-fold inventory stock that the merge combined. The confirm dialog must warn the user to re-check Inventory.
