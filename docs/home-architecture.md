# Web Home architecture boundaries

`artifacts/run-calculator/src/pages/home.tsx` is the composition root for the
web calculator. It is intentionally not the source of truth for every kind of
state.

## Ownership map

- **Run identity and selection:** `useHomeRunIdentity` owns the derived current
  run/id pair and its synchronous latest-id ref; Home owns `dayState`,
  `dayStateRef`, and run-switch handoff/reset behavior. A run switch must
  settle the form for the new run before autosave can write.
- **Navigation:** `useHomeNavigation` owns the persisted active tab and the
  bounded tab back-stack. It must not read or write day-state, run values, or
  sync refs.
- **Live operational state:** `LiveRunProvider` owns the clock, calculation,
  auto-track bookkeeping, live notifications, and live-only derived values.
  Components that do not call `useLiveRun` must not subscribe to the per-second
  clock. `calcRef` is the intentional non-subscribing bridge for Home-level
  coordination.
- **Persistence and sync:** Home owns the sync protocol and its fences
  (`formHandoffRef`, `isSyncApplyingRef`, foreground barrier, and push
  generation). `storage.ts` owns local persistence and pure merge/guard
  helpers; it does not own React state or navigation.
- **Station composition:** `HomeStationTabs` owns the controlled tab-container
  contract. Station panels own station-specific rendering and local UI state,
  consuming `HomeTabCtx` and `LiveRunContext` rather than lifecycle effects.

## Change rules

1. Do not move clock/timer state into Home or add `useLiveRun` to a non-live
   shell component just to read a value; use a snapshot bridge or a focused
   station component.
2. Do not make autosave infer identity from a render-local `currentRun`.
   Preserve the settled-form/run-id guard and the handoff fence.
3. Sync receive, foreground wake reconciliation, and daily reset are lifecycle
   transitions. Keep their existing ordering and refs together when extracting
   adapters; a successful HTTP response is not by itself proof that state was
   persisted.
4. A station panel may request a run or tab transition through a callback, but
   must not update sync stamps or write another copy of day-state.
5. When a change crosses these boundaries, update the owning hook/context first
   and keep Home as the composition root rather than duplicating the state in a
   panel.