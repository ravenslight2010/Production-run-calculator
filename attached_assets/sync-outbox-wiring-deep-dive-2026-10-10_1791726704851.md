# Sync Outbox Wiring Deep Dive

**Date:** 2026-10-10  
**Branch:** `Replit`  
**Primary files:**
- `artifacts/api-server/src/lib/syncOutbox.ts`
- `artifacts/api-server/src/routes/sync.ts`
- `lib/db/src/schema/syncOutbox.ts`

---

## 1. Purpose

Cross-process live sync for Autoscale: a write on API process **A** must reach SSE clients connected to API process **B**.

**Design (owner-approved 2026-10-10):** durable **PostgreSQL outbox** + **`LISTEN/NOTIFY` wake-ups**.  
NOTIFY is **not** the replay source; ordered outbox rows are.

This **supersedes** the earlier owner choice of SSE Option A (single always-on API process only). Autoscale is retained; single-process is no longer the selected requirement.

---

## 2. Data flow

```text
API process A (writer)                 PostgreSQL                      API process B (SSE peers)
──────────────────────                 ──────────                      ────────────────────────
tx: mutate daily_sync / reset / …
tx: appendSyncOutboxEvent
  → lock scope cursor
  → INSERT sync_outbox_events
  → pg_notify('sync_outbox', {scope,cursor})
local broadcast() to clients on A

                                       NOTIFY and/or 5s poll
                                                │
                                                ▼
                               startSyncOutboxListener
                               drainScope from process cursor
                               dispatchSyncOutboxEvent
                                 if origin == this process → skip
                                 else → broadcast / reset / config
                                        to clients on B
```

SSE connections remain **process-local** (`const clients = new Set<SseClient>()` in `sync.ts`). The outbox only **replicates the signal** so each process can push to its own clients.

---

## 3. Schema

Tables (see `lib/db/src/schema/syncOutbox.ts`):

| Table | Role |
|-------|------|
| `sync_outbox_cursors` | Per-scope monotonic cursor |
| `sync_outbox_events` | Durable events: scope, cursor, kind, date, sender_id, payload, created_at |

Indexes include `(scope, cursor)` uniqueness and `created_at` for retention.

---

## 4. `syncOutbox.ts` API

| Symbol | Role |
|--------|------|
| `processOrigin` | UUID per API process lifetime |
| `isLocalSyncOutboxEvent` | Skip events this process already applied locally |
| `appendSyncOutboxEvent(tx, event)` | Same transaction as the domain write |
| `recordSyncOutboxEvent(event)` | Standalone transaction when no outer tx |
| `registerSyncOutboxScope(scope)` | Seed in-memory cursor before baseline read |
| `startSyncOutboxListener(handleEvent, handleGap)` | LISTEN + poll + retention; returns stop fn |

### Event kinds

- `day-state` — scope, date, senderId, canonicalRevision (pointer; full blob re-read on dispatch)
- `reset` — scope, resetEpoch
- `rollover` — scope, date, resetEpoch
- `manual-section` — lock acquire/release metadata
- `configuration` — family: master-data | profiles | factory-data | die-types | supervisor-pin | name-links | merged-away

### Append algorithm

1. Assert bounded fields (scope/date/sender lengths).
2. Ensure cursor row for scope; `SELECT … FOR UPDATE`.
3. `cursor = current + 1`; update cursor row.
4. Insert event row with `origin` embedded in payload.
5. `SELECT pg_notify('sync_outbox', json{scope,cursor})`.

### Listener algorithm

- One dedicated `PoolClient` per process: `LISTEN sync_outbox`.
- On notification **or** every **5s**: drain all known scopes from in-memory cursor.
- Batch read events with `cursor > local`; parse; invoke `handleEvent`.
- On gap: invoke `handleGap(scope, latestCursor)`.
- Reconnect with backoff on listener errors; durable catch-up does not depend on NOTIFY.
- Retention: delete events older than **7 days** (hourly attempt).
- Disabled in unit tests unless `SYNC_OUTBOX_LISTENER_TEST_ENABLED=1`.

---

## 5. `sync.ts` integration

### Imports / lifecycle

```ts
import {
  appendSyncOutboxEvent,
  isLocalSyncOutboxEvent,
  recordSyncOutboxEvent,
  registerSyncOutboxScope,
  startSyncOutboxListener,
  type StoredSyncOutboxEvent,
} from "../lib/syncOutbox";

// module load:
const stopSyncOutboxListener = startSyncOutboxListener(
  dispatchSyncOutboxEvent,
  reconcileOutboxGap,
);

export function stopSyncOutboxFanout(): void {
  stopSyncOutboxListener();
}
```

### `dispatchSyncOutboxEvent`

| Kind | Action |
|------|--------|
| Local origin | Return immediately |
| `day-state` | Load `daily_sync` row → `broadcast(data, senderId, scope, date, { canonicalRevision })` |
| `reset` | `broadcastReset(scope, resetEpoch)` |
| `rollover` | `broadcastRollover` + forced `broadcast` of that date’s row |
| `manual-section` | Drop **acquire** if event age ≥ ~35s; else peer lock frame |
| `configuration` | Peer configuration / master-data invalidation path |

### Local vs remote

- **Writer process:** still calls `broadcast` / `broadcastReset` immediately after commit so local SSE clients do not wait for self-NOTIFY.
- **Remote process:** only `dispatchSyncOutboxEvent` after drain.

### Write sites that append (representative)

Same transaction as mutation where possible:

- Protected day-state PUT / complete / partial paths
- Accepted operational intents / commands
- Server auto-track tick when claims accepted
- `POST` reset and purge-all (reset epoch events)
- Configuration invalidation via `recordSyncOutboxEvent` (or append with `outboxAlreadyPersisted` on broadcast helpers)

### Broadcast helpers (still local Set)

- `broadcast` — scope + watchDate isolation; optional `outboxCursor` on frames; exact-snapshot skip; delta vs complete peer recovery
- `broadcastMasterDataChanged` — facility-wide; records outbox unless already persisted
- `broadcastReset` / `broadcastRollover`
- `reconcileOutboxGap` — force scoped clients to recover canonical state after cursor gaps

---

## 6. Isolation rules (unchanged product constraints)

- Sandbox writers must not stream into live watchers (scope filter).
- Day-state peers filtered by **watchDate** (cross-date clobber prevention).
- Reset frames clear clients across dates for that scope.
- Soft readiness: outbox listener failures should degrade fanout, not hard-fail `/readyz` (listener logs warn/retry).

---

## 7. Verification already retained

**Isolated (not production):** `docs/evidence/sync-peer-fanout-2026-10-10.json`

- Base commit includes outbox implementation (`3a41682c…`).
- Two API processes, disposable Postgres, 7 tests passed.
- Verified: cross-process day-state, scope/date isolation, duplicate NOTIFY safety, listener reconnect, durable insert without NOTIFY via cursor poll, reset/rollover, master-data invalidation, new SSE baseline after reconnect.

**Conclusion in that file:** `isolatedCrossProcessFanout: VERIFIED`, `publishedLivePeerSse: NOT_SUPPORTED`.

---

## 8. Operational notes

| Topic | Note |
|-------|------|
| Extra DB usage | One LISTEN connection per API process + short drain queries |
| Failure mode | Listener down → peers lag until reconnect/poll; writers still succeed |
| Dual broadcast | Local broadcast + outbox is intentional; remote skips local origin |
| Agent memory | `.agents/memory/sse-topology-choice.md` records Autoscale + outbox approval |

---

## 9. Related commits (Replit, 2026-10-10)

| SHA (short) | Message |
|-------------|---------|
| `ba178a61` | Record approved Autoscale peer-fanout direction and capacity gate |
| `3a41682c` | Add durable PostgreSQL outbox fanout for sync updates |
| `cf9591e3` | Verify isolated cross-process sync fanout; sanitized evidence |
| `8c0b53a2` | Retain Autoscale capacity evidence; keep unsupported status explicit |

---

*Deep dive compiled 2026-10-10 from Replit tip sources.*
