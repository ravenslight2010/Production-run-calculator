# Sync System Improvements — Plan

**Updated:** 2026-09-18 (aligned with improvement research)  
**Related:** [improvement-research-2026-09-18.md](improvement-research-2026-09-18.md), [idea-backlog.md](idea-backlog.md) §16

## Current State

### What Exists Today

The sync system (`artifacts/api-server/src/routes/sync.ts`) is considerably more advanced than older backlog text credited it for. Several formerly listed “ideas” are already solved:

- **Optimistic locking / LWW** — every day-state row carries a `canonicalRevision`; writes are additive/tombstone-driven (`upsertProtected`), never a blind overwrite
- **Conflict-safe merge** — `protectRunValues` + `capMergedResult` guard against a blank/stale push clobbering real data (the "I entered it, it vanished" invariant)
- **Live push** — SSE (`GET /sync/events`) broadcasts canonical state on every accepted write (`broadcast`, `broadcastMasterDataChanged`, `broadcastReset`, `broadcastRollover`)
- **Offline queue** — `syncPushQueue` (web) queues mutations while offline and drains on reconnect; `operationalMutationCursor` tracks replay position
- **Daily-reset session fence** — `sessionBoundary.ts` force-expires stale tokens at the facility-local reset boundary (`applyResetBoundary`, `resetBoundaryAt`)
- **Server-authoritative live-calc** — auto-track ticks, wall-clock claims, and the operational projection are computed server-side and streamed, not trusted from clients
- **Resilience** — bounded pool acquisition, idle-client recovery, `/healthz` stays responsive under pool exhaustion (`lib/resilience.ts`)

### What's Genuinely Still Missing

1. **No delta sync** — every write pushes/stores the FULL `dayState`, not a diff
2. **No payload compression** — full JSON body over the wire every time (secondary if deltas land)
3. **No per-device sync health visibility** — no way to see "this device is 40s behind" or "this device hasn't synced in 10 minutes"
4. **No conflict resolution UI** — conflicts are resolved silently server-side (correctly, per the LWW/protect rules), but a device that "lost" a merge has no visual indication anything was reconciled
5. **No selective sync** — every device pulls the full day-state row even if only viewing one run

---

## Why Delta Sync Is the Priority (not a nice-to-have)

`.agents/memory/sync-body-limit.md` documents a **real production incident** from this exact gap: real-world day-state payloads (full per-run `FormValues` for every run) outgrew Express's default body limit and started returning `413` on every write — silently breaking live sync and scheduled-day saves until the limit was raised. That file's own conclusion prefers trimming non-essential fields / structural reduction over endlessly raising the limit. The payload driver (per-run full recipe `FormValues`) only grows as more per-run fields get added — the next incident is a matter of when, not if, unless this is addressed structurally.

**Standard approaches:**

- **Neil Fraser's Differential Synchronization** — each side keeps a shadow of the last state it knows the other side has; diffs against it before sending; failed diff triggers full resync
- **JSON Patch (RFC 6902)** — standard diff/patch format for JSON documents; well-suited because day-state is already a JSON blob
- Production offline-sync engines converge on: local-first write → diff against last-synced shadow → send only the delta → server applies patch and returns its own delta since the client's last acknowledged revision

---

## Proposed System

### 1. Delta Sync (new — top priority)

**What:** Client and server each keep a shadow of the last mutually-acknowledged `dayState` (keyed by `canonicalRevision`, which already exists). On write, the client diffs its current state against its shadow and sends only the patch; the server applies the patch, updates its own shadow, and the SSE broadcast likewise sends a patch relative to each subscriber's last-acknowledged revision instead of the full state when possible.

**How:**

- Use JSON Patch (RFC 6902) semantics for the diff/patch format
- Keep `canonicalRevision` as the shadow key (already the LWW version counter — no new versioning concept needed)
- **Fallback to full sync:** if a client's shadow revision is missing, stale beyond a bound, or a patch fails to apply cleanly, fall back to sending the full state — bounds the blast radius of any patch-computation bug to "no worse than today"
- Keep `protectRunValues` / `capMergedResult` unchanged — they operate on the reconstructed full state after a patch is applied, not on the wire format

**Benefit:** Directly addresses the payload-growth risk `sync-body-limit.md` flagged, and reduces bandwidth on every heartbeat/SSE push (facility Wi‑Fi).

**Risk / sequencing:** This touches the hottest path (`upsertProtected`, reset-boundary fence, SSE broadcast loop). Land shadow/diff machinery as an **additive, feature-flagged path** that can fall back to today's full-state behavior instantly, and prove it first against `sync.convergence.integration.test.ts` before removing the full-state path.

### 2. Per-Device Sync Health (new)

**What:** Surface which devices are behind, offline, or repeatedly failing to sync — today this is invisible to managers.

**How:**

- Each device's SSE connection / last successful write already carries a timestamp; persist "last seen" per (userId, deviceId) the way `webPush` already tracks per-device subscriptions
- A small "Sync Health" panel (mirroring `DataHealthWorkspace`) showing: device, last sync time, pending queue depth (from `syncPushQueue`), current `canonicalRevision` vs server's

**Benefit:** Turns "the tablet in the freezer hasn't synced in 20 minutes" from a mystery into something a manager can act on before it becomes a lost-run-data incident.

### 3. Conflict Visibility (new)

**What:** When `protectRunValues` / `capMergedResult` reject or reconcile a device's write (correctly, per existing LWW rules), that device currently has no signal anything happened — it just silently receives the canonical (different) state back.

**How:**

- Tag the SSE/response payload with a lightweight `reconciled: true` marker when the server's accepted state differs from what the client sent
- Client shows a small, non-blocking toast: "Another device's changes were kept for [field]" — informational, not blocking

**Benefit:** Closes the trust gap where a device silently "loses" an edit with no indication why.

### 4. Selective Sync (deferred)

**What:** A device only viewing one run's live status doesn't need the full day's `dayState` pushed on every beat.

**Status:** Lower priority than delta sync — delta alone shrinks the common case significantly, and selective sync adds real complexity (partial-state reconstruction, cross-run invariants). Revisit after delta sync ships and bandwidth savings are measured.

### 5. Blank-template lockstep (related defect)

Client `DEFAULT_VALUES` and server `CURRENT_BLANK_RUN_VALUE` must stay field-aligned (including defaults like `cartonSize`). Drift only degrades blank recognition; it must not ship without a lockstep regression test. See improvement research §2.1.

---

## Build Order

### Phase 1: Foundation

1. **Delta sync** (shadow + JSON Patch diff/apply, feature-flagged, full-state fallback)
2. Prove against `sync.convergence.integration.test.ts` + a soak with induced patch-apply failures (confirm fallback engages)
3. **Blank-template lockstep** test + any outstanding field alignment

### Phase 2: Visibility

4. **Per-device sync health** panel
5. **Conflict visibility** toast

### Phase 3: Deferred

6. Selective sync (only after delta sync's real-world impact is measured)
7. Payload compression (gzip/brotli) — revisit if profiling still shows need after deltas

---

## Key Code References

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/routes/sync.ts` | Sync endpoints, `upsertProtected`, `broadcast*`, `applyResetBoundary` |
| `artifacts/api-server/src/lib/protectRunValues.ts` | Blank-over-populated merge guard (unchanged by delta sync — operates post-patch-apply) |
| `artifacts/api-server/src/lib/sessionBoundary.ts` | Daily-reset auth fence (unrelated to delta sync) |
| `artifacts/run-calculator/src/contexts/SyncContext.tsx` | Client sync state/subscription |
| `artifacts/run-calculator/src/syncPushQueue.ts` | Offline mutation queue |
| `artifacts/run-calculator/src/types.ts` | Client `DEFAULT_VALUES` (blank lockstep) |
| `.agents/memory/sync-body-limit.md` | Evidence trail for why delta sync matters |
| `.agents/memory/sync-convergence-soak.md` | Existing stability notes; extend for patch-fallback soak |
| `.agents/memory/sync-retry-storms.md` | Related resilience — check interaction with patch-fallback retries |

## API Changes (proposed)

- `PUT /api/sync/today` / `PUT /api/sync/:date` — accept optional JSON Patch body alongside existing full-state body; server falls back to full-state handling if patch application fails
- `GET /api/sync/events` (SSE) — broadcast frames become patches relative to each subscriber's last-acknowledged revision where possible; full state on first connect or after a gap
- `GET /api/sync/health` (new) — per-device last-seen / queue-depth for the Sync Health panel
