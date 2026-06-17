---
name: Web+mobile live sync
description: How the Expo mobile app joins the web app's real-time /api/sync day-state sync, and the rules that keep neither platform clobbering the other.
---

# Web + mobile live sync

Both `artifacts/run-calculator` (web) and `artifacts/run-calculator-mobile` (Expo)
live-sync "today's" working state through the same api-server endpoints
(`PUT/GET /api/sync/today`, SSE `GET /api/sync/events`). The jsonb `SyncPayload`
contract is owned by web + db and is untyped on the server. Mobile mirrors it in
`context/sync/payloadTypes.ts` and maps to/from its local AppState in
`context/sync/mapping.ts` (pure fns); transport + clientId live in
`context/sync/client.ts`; orchestration is in `context/RunContext.tsx`.

## Non-clobber rules (the whole point — easy to regress)
- **Top-level web-only fields** (templates, history, presets, profiles,
  ingredientTypes, crustProfiles, etc.) are preserved by spreading `lastRaw`
  FIRST in `appStateToPayload`, then overlaying mobile-owned fields.
- **Per-run web-only RunMeta fields** (`pausedAt`, `actualCases`, `wasteLbs`,
  `gapType`, `gapNote`) are preserved by `runToMeta(run, rawMeta)`: it spreads the
  prior remote meta for that run id first, then overrides mobile-owned fields.
  `appStateToPayload` builds a Map of `lastRaw.dayState.runs` by id for this.
  **Why:** mobile doesn't model these; without the per-run merge a mobile write
  drops them and desyncs web (notably paused state).
- **Mobile-only fields** (doughBatchLbs, stopReasons, supervisorPin, autoTrack,
  mixRecipePresets, scheduled) stay local; never serialized.
- Field renames: `lineSpeedPPM`↔`approxLineSpeed`,
  `doughballWeightOz`↔`targetDoughballWeight`. Mobile `run.progress.*` folds INTO
  web FormValues; `subTab` lives in RunMeta. Stoppage `type` enums differ — mapped
  both ways, never copied raw.

## Loop / lost-update guards
- **Echo guard:** ignore SSE messages whose `senderId === our clientId`; also a
  `lastSyncSigRef` deterministic-JSON signature compare skips no-op re-pushes and
  echoes of just-applied remote state.
- **Push reliability:** `putToday` throws on non-OK; `doPush` records the synced
  signature ONLY after a successful PUT, else marks offline + retries
  (`PUSH_RETRY_MS`). **Why:** recording the signature before/ignoring failures
  marks a failed push as synced and the signature guard then blocks any retry =
  silently lost update.
- **Edit-quiet defer:** incoming remote payloads are held while the user is
  actively editing (`EDIT_QUIET_MS` since last local edit) so a live update can't
  overwrite the field being typed in.
- **Reset guard:** accept a remote day only if `remoteDate === today` &&
  `remoteResetAt >= localResetAt` (mirrors web). Master-data lists union-merge
  unconditionally.

## Gotchas
- **Taxonomy migrations must be enforced on the inbound sync path, not just on-load.**
  Renaming/retiring master-data values (e.g. pep-type renames, dropping a value)
  only in `normalizeState`/on-load migration is NOT enough: a legacy peer re-adds
  the old value through `applyPayloadToState` (mobile `unionList`) or the web sync
  `mergeList`/setters. Apply the same rename+drop-retired cleanup to incoming
  payload lists AND to incoming run/settings refs (mobile `formValuesToSettings`,
  web `cleanedRemotePep`), or the value resurrects and propagates back out. This
  covers BOTH pep-type renames AND ingredient/app-type renames (cheeseIngredients +
  ingredientTypes lists, app*Type fields, recipe-row ingredients): mobile routes
  ingredient ingress through `renameIngredientSettings`/`renameIngredientList`, web
  through `INGREDIENT_RENAMES` on the cheese/ingredient list merges. Web run-value
  ingredient names self-heal via read-path `normalizePepFields`→`normalizeIngredientFields`.
- **Web sync setState must be change-guarded.** The outgoing payload echoes
  loadHistory()/master lists every SSE cycle (~10s); calling setState/`setHistory`/
  `setDayState`/`setBrands`/etc. unconditionally on each inbound echo causes a
  re-render storm that resets open-menu scroll position. Guard every sync setter
  with an equality check (arraysEqual / JSON.stringify) and return prev when equal.
- `getApiBaseUrl()` builds from `process.env.EXPO_PUBLIC_DOMAIN` → `https://<domain>`.
- SSE transport branches on `Platform.OS`: web uses global `EventSource`, native
  uses `react-native-sse`.
- mapping.ts imports DEFAULT_SETTINGS/DEFAULT_PROGRESS/todayStr from RunContext —
  circular but safe (only referenced inside fns, live bindings). DEFAULT_PROGRESS
  had to be exported for this.
