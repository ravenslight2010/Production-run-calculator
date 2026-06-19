---
name: Mobile sync async crash safety
description: Why the mobile live-sync serialize/deserialize paths must never throw, and which paths are un-catchable by the error boundary.
---

# Mobile sync async crash safety

In the Expo app, an uncaught error inside an **async callback** (a `setTimeout`,
a `Promise.then`, or the SSE `onPayload` handler) is NOT caught by React's
ErrorBoundary — it hard-crashes the JS context to a blank/"tap to reload"
screen with NO "Something went wrong" fallback. Errors thrown during render or
synchronously inside a `useEffect` body DO surface the fallback. So:

- "Crash with the fallback screen" → look in render / sync effect bodies.
- "Crash with NO fallback, blank screen, recovers only by clearing data" →
  look in async paths: the sync push timer (`doPush` in a `setTimeout`),
  `commitRemote` (called from the SSE callback / deferred timer), or persisted-
  state load.

**Why this bit us:** the live-sync serializer (`appStateToPayload` →
`runToMeta` does `run.stoppages.map(...)`) and deserializer
(`applyPayloadToState` → `metaToRun`, `ds.runs.map(...)`) ran un-guarded in
those async paths. A run/payload with a missing-or-non-array `stoppages`, a
non-array `ds.runs`, or a null run-meta would throw and kill the app. And
because the bad day-state lives on the **server**, clearing local AsyncStorage
then rebooting just pulls it back via sync and re-crashes "shortly after".

**Rule:** treat sync serialize/deserialize as best-effort and fail-safe.
- `doPush`: wrap the payload build in try/catch → degrade to `offline`, never throw.
- `commitRemote`: wrap inside the `setAppState` updater → return `prev` on any throw.
- change-watcher effect: wrap the signature build → bail on throw.
- `normalizeRun`: guarantee `stoppages` is an array.
- `applyPayloadToState`/`metaToRun`: guard `ds.runs`/`meta.stoppages` are arrays
  and filter null/invalid metas before mapping.

The web app was already robust here — it guards every `.stoppages` with `?? []`.
This was a mobile-only gap; the fix changes nothing on valid data, so web↔mobile
behavior parity is preserved.
