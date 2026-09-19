# Sync System Improvements — Plan

**Updated:** 2026-09-19 (aligned with current partial-sync implementation)
**Related:** [unified reliability plan](sync-reliability-unified-plan-2026-09-19.md), [sync-deep-dive-2026-09-19.md](sync-deep-dive-2026-09-19.md), [reconnect-reliability-deep-dive-2026-09-19.md](reconnect-reliability-deep-dive-2026-09-19.md), [improvement-research-2026-09-18.md](improvement-research-2026-09-18.md), [idea-backlog.md](idea-backlog.md) §16

## Current State

### What Exists Today

The sync system (`artifacts/api-server/src/routes/sync.ts`) is considerably more advanced than older backlog text credited it for. Several formerly listed “ideas” are already solved:

- **Protected merge with route-specific revision semantics** — every day-state row carries a `canonicalRevision`, but ordinary day-state PUT retains it and does not enforce it as a universal write precondition; `upsertProtected`, tombstones, and per-run LWW still protect established merge invariants
- **Conflict-safe merge** — `protectRunValues` + `capMergedResult` guard against a blank/stale push clobbering real data (the "I entered it, it vanished" invariant)
- **Live push** — SSE (`GET /sync/events`) broadcasts canonical state on every accepted write (`broadcast`, `broadcastMasterDataChanged`, `broadcastReset`, `broadcastRollover`)
- **Partial PUT** — sparse writes carry `syncVersion: 1` + `baseSnapshotId`; the base is validated under lock and stale/malformed/raced dependencies return complete `partialFallback` without applying the sparse write
- **Conditional partial peer SSE** — peers receive a partial frame when the delta is safe and materially smaller; complete initial/recovery and fallback frames remain available
- **Snapshot unchanged short-circuit** — matching snapshot requests avoid retransmitting the document
- **Offline queue** — `syncPushQueue` (web) queues mutations while offline and drains on reconnect; `operationalMutationCursor` tracks replay position
- **Daily-reset session fence** — `sessionBoundary.ts` force-expires stale tokens at the facility-local reset boundary (`applyResetBoundary`, `resetBoundaryAt`)
- **Server-authoritative live-calc** — auto-track ticks, wall-clock claims, and the operational projection are computed server-side and streamed, not trusted from clients
- **Resilience** — bounded pool acquisition, idle-client recovery, `/healthz` stays responsive under pool exhaustion (`lib/resilience.ts`)

### What's Genuinely Still Missing

1. **No measured partial-adoption baseline** — success/fallback rates and complete-vs-partial wire percentiles are not retained as production evidence
2. **Partial coverage remains coarse** — expand only for measured hot paths; JSON Patch is optional, not prerequisite
3. **No complete per-device sync health view** — `GET /sync/health` and aggregate conflict stats exist, but managers still cannot compare every device's last-seen time, queue depth, and revision lag
4. **No field-specific conflict reconciliation UI** — server conflict logging/stats exist, but a device whose value loses a successful merge still lacks a direct explanation
5. **Reconnect causality remains incomplete** — ordinary partial writes use snapshot bases, but complete-write revision preconditions and future client-stamp policy are not established
6. **No selective sync** — partial wire frames are not the same as per-run read scope

---

## Why Complete-Write Causality and Measurement Are the Priority

`.agents/memory/sync-body-limit.md` documents a production **413** when real day-state payloads outgrew Express's default parser limit. The parser now accepts up to 10 MB, while sanitized sync documents are capped at 512 KB. Current partial PUT and conditional partial peer SSE address eligible wire growth. The immediate correctness gap is complete-write causality; adoption and fallback rates must then be measured before broader sparse sections or JSON Patch are considered.

**Standard approaches:**

- **Neil Fraser's Differential Synchronization** — each side keeps a shadow of the last state it knows the other side has; diffs against it before sending; failed diff triggers full resync
- **JSON Patch (RFC 6902)** — standard diff/patch format for JSON documents; well-suited because day-state is already a JSON blob
- Production offline-sync engines converge on: local-first write → diff against last-synced shadow → send only the delta → server applies patch and returns its own delta since the client's last acknowledged revision

---

## Proposed System

### 1. Partial-Sync Measurement and Expansion

**What exists:** The client sends sparse documents against a canonical `baseSnapshotId`. The server validates that base under the row lock, inherits omitted sections, runs the normal protected merge, and returns complete authoritative fallback without applying the sparse write on a stale or invalid base. The broadcaster can compute a peer delta from each connection's accepted baseline and sends it only when materially smaller.

**How:**

- Instrument complete, partial, and `partialFallback` PUTs plus complete/partial SSE frame sizes
- Preserve snapshot validation under lock and complete recovery/fallback
- Expand sparse sections only for measured hot paths
- Keep `protectRunValues` / `capMergedResult` after full reconstruction
- Prototype JSON Patch only if the current sparse contract cannot meet measured goals

**Benefit:** Builds on the current contract and reduces payload risk without introducing another encoding prematurely.

**Risk / sequencing:** This touches the hottest path (`upsertProtected`, reset-boundary fence, SSE broadcast loop). Preserve the complete path, prove stale-base behavior against convergence and large-day suites, and do not assume `canonicalRevision` increments on every ordinary day-state write without route-specific evidence.

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

**Status:** Lower priority than measuring and expanding the current partial contract. Selective sync adds read-scope and cross-run reconstruction complexity; revisit only after current wire savings are measured.

### 5. Blank-template lockstep (resolved guardrail)

Client `DEFAULT_VALUES` and server `CURRENT_BLANK_RUN_VALUE` are currently field-aligned, including `cartonSize: 1`, and regression coverage mirrors the client-shaped blank. Keep that lockstep test mandatory: future drift would degrade blank recognition even though stamp-based LWW still prevents false rejection of real edits. See improvement research §2.1.

---

## Build Order

### Phase 1: Correctness

1. Add the future-stamped stale-complete regression and audit every complete-write entry point
2. Require a trusted complete-write base and return canonical state without applying on mismatch
3. Preserve reset, wake, auto-track, packaging, inventory side-effect, tombstone, and blank-protection invariants
4. Correct readiness provider-key detection independently of AI dependency policy
5. Add evidence-safe complete/partial/fallback/SSE and pool measurements

### Phase 2: Deployment Evidence and Visibility

6. Run the authenticated published SSE probe and deterministic two-process fanout test
7. Compute the database pool budget from capacity and maximum-instance inputs
8. **Per-device sync health** panel using the existing read-only health and conflict evidence
9. **Conflict visibility** toast

### Phase 3: Deferred

10. Expand sparse coverage only for proven hot paths
11. Optional JSON Patch encoding
12. Selective sync
13. Payload compression or timestamp policy if profiling still shows need

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
| `artifacts/api-server/src/routes/sync.convergence.integration.test.ts` | Existing convergence suite; extend for patch-fallback soak |
| `.agents/memory/sync-retry-storms.md` | Related resilience — check interaction with patch-fallback retries |
| `docs/sync-deep-dive-2026-09-19.md` | Current partial PUT/SSE contract and invariants |
| `docs/reconnect-reliability-deep-dive-2026-09-19.md` | Adopt-before-publish and stale-overwrite design |

## API Status and Proposed Changes

- `PUT /api/sync/today` / `PUT /api/sync/:date` — complete and partial sparse bodies exist; JSON Patch is optional future work
- `GET /api/sync/events` — complete initial/recovery frames and conditional partial peer frames exist
- `GET /api/sync/health` — authenticated, manager-facing read-only sentinel exists; per-device last-seen/queue-depth remains proposed
