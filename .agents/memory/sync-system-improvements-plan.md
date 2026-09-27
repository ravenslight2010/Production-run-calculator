# Sync System Improvements — Plan

**Updated**: 2026-09-18 — merged with an independent research pass (`improvement-research-2026-09-18.md`,
`idea-backlog.md` §16) that reached the same delta-sync conclusion and added the
blank-template-lockstep item (§5 below).

## Current State

### What Exists Today
The sync system (`artifacts/api-server/src/routes/sync.ts`, 2700+ lines) is considerably
more advanced than `docs/idea-backlog.md` #16 credits it for — several of that doc's
"ideas" are already solved:

- **Optimistic locking / LWW** — every day-state row carries a `canonicalRevision`;
  writes are additive/tombstone-driven (`upsertProtected`), never a blind overwrite
- **Conflict-safe merge** — `protectRunValues` + `capMergedResult` guard against a
  blank/stale push clobbering real data (the "I entered it, it vanished" invariant)
- **Live push** — SSE (`GET /sync/events`) broadcasts canonical state on every accepted
  write (`broadcast`, `broadcastMasterDataChanged`, `broadcastReset`, `broadcastRollover`)
- **Offline queue** — `syncPushQueue` (web) queues mutations while offline and drains on
  reconnect; `operationalMutationCursor` tracks replay position
- **Daily-reset session fence** — `sessionBoundary.ts` force-expires stale tokens at the
  facility-local reset boundary (`applyResetBoundary`, `resetBoundaryAt`)
- **Server-authoritative live-calc** — auto-track ticks, wall-clock claims, and the
  operational projection are computed server-side and streamed, not trusted from clients
- **Resilience** — bounded pool acquisition, idle-client recovery, `/healthz` stays
  responsive under pool exhaustion (`lib/resilience.ts`)

### What's Genuinely Still Missing
1. **No delta sync** — every write pushes/stores the FULL `dayState`, not a diff
2. **No payload compression** — full JSON body over the wire every time
3. **No per-device sync health visibility** — no way to see "this device is 40s behind" or "this device hasn't synced in 10 minutes"
4. **No conflict resolution UI** — conflicts are resolved silently server-side (correctly, per the LWW/protect rules), but a device that "lost" a merge has no visual indication anything was reconciled
5. **No selective sync** — every device pulls the full day-state row even if only viewing one run

---

## Why Delta Sync Is the Priority (not a nice-to-have)

`.agents/memory/sync-body-limit.md` already documents a **real production incident** from
this exact gap: real-world day-state payloads (full per-run `FormValues` for every run)
outgrew Express's default 100kb body limit and started returning `413` on every write —
silently breaking live sync and scheduled-day saves until the limit was raised to 10mb.
That file's own conclusion: *"Prefer trimming non-essential fields from the synced
payload over endlessly raising the limit."* That trim was never built. The payload driver
(per-run full recipe `FormValues`) only grows as more per-run fields get added — the next
incident is a matter of when, not if, unless this is addressed structurally rather than by
raising the limit again.

**This is a well-trodden problem, not a novel bet.** The standard approaches:
- **Neil Fraser's Differential Synchronization algorithm** (used in Google Docs, Google
  Wave) — each side keeps a "shadow" of the last state it knows the other side has,
  diffs against it before sending, and the receiver reconstructs from the diff. Tolerant
  of lost/reordered messages because a failed diff just triggers a full resync.
- **JSON Patch (RFC 6902)** — a standard diff/patch format for JSON documents
  (`jsondiffpatch` and similar libraries implement this). Well-suited here since the
  day-state payload is already a JSON blob.
- Production offline-sync engines (e.g. `dynos_sync`) converge on the same pattern:
  local-first write → diff against last-synced shadow → send only the delta → server
  applies the patch and returns its own delta since the client's last acknowledged
  revision.

---

## Proposed System

### 1. Delta Sync (new — top priority)
**What**: Client and server each keep a "shadow" of the last mutually-acknowledged
`dayState` (keyed by `canonicalRevision`, which already exists). On write, the client
diffs its current state against its shadow and sends only the patch; the server applies
the patch, updates its own shadow, and the SSE broadcast likewise sends a patch relative
to each subscriber's last-acknowledged revision instead of the full state.

**How**:
- Use JSON Patch (RFC 6902) semantics for the diff/patch format — well-specified,
  library-supported, and directly maps onto the existing plain-JSON `dayState` shape
- Keep `canonicalRevision` as the shadow key (already the LWW version counter — no new
  versioning concept needed)
- **Fallback to full sync**: if a client's shadow revision is missing, stale beyond a
  bound, or a patch fails to apply cleanly, fall back to sending the full state (exactly
  Differential Synchronization's own recovery strategy) — this bounds the blast radius of
  any patch-computation bug to "no worse than today"
- Keep `protectRunValues`/`capMergedResult` unchanged — they operate on the
  reconstructed full state after a patch is applied, not on the wire format

**Benefit**: Directly addresses the payload-growth risk `sync-body-limit.md` already
flagged as recurring, without an endless string of body-limit bumps. Also reduces
bandwidth for every device on every heartbeat/SSE push, which matters most on the
facility floor's likely-weaker wifi.

**Risk / sequencing note**: this touches the hottest, most heavily-guarded path in the
codebase (`upsertProtected`, the reset-boundary fence, the SSE broadcast loop). Build and
land the shadow/diff machinery as an **additive, feature-flagged path** that can fall back
to today's full-state behavior instantly, and prove it first against
`sync.convergence.integration.test.ts` (the existing soak-style convergence test) before
removing the full-state path.

### 2. Per-Device Sync Health (new)
**What**: Surface which devices are behind, offline, or repeatedly failing to sync —
today this is invisible to managers.

**How**:
- Each device's SSE connection / last successful write already carries a timestamp;
  persist "last seen" per (userId, deviceId) the way `webPush` already tracks per-device
  subscriptions
- A small "Sync Health" panel (mirroring the existing `DataHealthWorkspace` pattern used
  for master-data health) showing: device, last sync time, pending queue depth (from
  `syncPushQueue`), current canonicalRevision vs. server's

**Benefit**: Turns "the tablet in the freezer hasn't synced in 20 minutes" from a mystery
into something a manager can see and act on before it becomes a lost-run-data incident.

### 3. Conflict Visibility (new)
**What**: When `protectRunValues`/`capMergedResult` reject or reconcile a device's write
(correctly, per the existing LWW rules), that device currently has no signal anything
happened — it just silently receives the canonical (different) state back.

**How**:
- Tag the SSE/response payload with a lightweight `reconciled: true` marker when the
  server's accepted state differs from what the client sent (already computable — the
  diff between `payloadForMerge` and the merged result `m`)
- Client shows a small, non-blocking toast: "Another device's changes were kept for
  [field]" — informational, not blocking, since the merge itself is already correct

**Benefit**: Closes the trust gap where a device silently "loses" an edit with no
indication why — a common source of "the app ate my changes" support complaints in
multi-device offline-sync systems generally.

### 4. Selective Sync (deferred)
**What**: A device only viewing one run's live status doesn't need the full day's
`dayState` (all runs, all scheduling) pushed on every beat.

**Status**: Lower priority than delta sync — delta sync alone shrinks the common case
significantly (most heartbeats change little), and selective sync adds real complexity
(partial-state reconstruction, cross-run invariants like `protectRunValues` needing the
full picture). Revisit after delta sync ships and its bandwidth savings are measured.

### 5. Blank-Template Lockstep (related defect, added from cross-agent research review)
**What**: client `DEFAULT_VALUES` (`artifacts/run-calculator/src/types.ts`) and server
`CURRENT_BLANK_RUN_VALUE` (`artifacts/api-server/src/lib/protectRunValues.ts`) must stay
field-for-field aligned, or the exact-match blank-recognition guard silently degrades
(falls back to stamp-based LWW, doesn't false-reject — by design — but loses the sharper
protection). This isn't hypothetical: `cartonSize` drifted out of lockstep in this exact
way and had to be fixed three separate times across three commits (the source constant,
its own test file's duplicate fixture, and a second test's exception list) — see
`.agents/memory/claude-bugs.md` for the full trail.

**How**: add a lockstep regression test asserting the server blank template deep-equals
the normalized client defaults (including machine-time/tunnel-time normalization), and
treat "add a new default field" as a two-sided change in the same PR, not a client-only
one. See `improvement-research-2026-09-18.md` §2.1 for the incident detail.

---

## Build Order

### Phase 1: Foundation
1. **Delta sync** (shadow + JSON Patch diff/apply, feature-flagged, full-state fallback)
2. Prove against `sync.convergence.integration.test.ts` + a new soak test with induced
   patch-apply failures (confirm fallback path actually engages)
3. **Blank-template lockstep** test (§5) — cheap, independent of delta sync, closes a
   defect class that's already recurred three times

### Phase 2: Visibility
4. **Per-device sync health** panel (reuses `DataHealthWorkspace` pattern)
5. **Conflict visibility** toast (reuses the diff already computed during merge)

### Phase 3: Deferred
6. Selective sync (only after delta sync's real-world bandwidth impact is measured)
7. Payload compression (gzip/brotli on the sync routes) — likely subsumed by delta sync
   shrinking payloads enough that compression's marginal benefit is small; revisit if
   profiling says otherwise

---

## Key Code References

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/routes/sync.ts` | Sync endpoints, `upsertProtected`, `broadcast*`, `applyResetBoundary` |
| `artifacts/api-server/src/lib/protectRunValues.ts` | Blank-over-populated merge guard (unchanged by delta sync — operates post-patch-apply) |
| `artifacts/api-server/src/lib/sessionBoundary.ts` | Daily-reset auth fence (unrelated to delta sync, don't conflate) |
| `artifacts/run-calculator/src/contexts/SyncContext.tsx` | Client sync state/subscription |
| `artifacts/run-calculator/src/syncPushQueue.ts` | Offline mutation queue (already exists) |
| `artifacts/run-calculator/src/types.ts` | Client `DEFAULT_VALUES` — the other half of the blank-template lockstep (§5) |
| `lib/db/src/schema/runs.ts` / daily sync table schema | Where `canonicalRevision` and the shadow (new) would live |
| `.agents/memory/sync-body-limit.md` | The evidence trail for why delta sync matters |
| `.agents/memory/sync-convergence-soak.md` | Existing stability notes; extend for patch-fallback soak testing |
| `.agents/memory/sync-retry-storms.md` | Related resilience work — check for interaction with patch-fallback retries |

## New Database Fields
- `daily_sync` table: add `shadowRevision` (or reuse `canonicalRevision` directly if a
  separate shadow pointer per-subscriber isn't needed — needs design confirmation before
  implementation) to track what each subscriber last acknowledged
- Device tracking (if not reusing `webPush`'s existing per-device rows): `deviceId`,
  `lastSyncAt`, `lastCanonicalRevisionSeen`

## API Changes
- `PUT /api/sync/today` / `PUT /api/sync/:date` — accept an optional JSON Patch body
  (`Content-Type: application/json-patch+json` or a wrapper field) alongside the existing
  full-state body; server falls back to full-state handling if patch application fails
- `GET /api/sync/events` (SSE) — broadcast frames become patches relative to each
  subscriber's last-acknowledged revision where possible, full state on first connect or
  after a gap
- `GET /api/sync/health` (new) — per-device last-seen/queue-depth for the Sync Health panel
