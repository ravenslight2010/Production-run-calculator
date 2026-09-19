# Server Research Deep Dive — Sync, SSE, Pool, Limits

**Date:** 2026-09-19  
**Code refs:** `artifacts/api-server/src/routes/sync.ts` (~2722 lines), `lib/protectRunValues.ts`, `lib/db/src/index.ts`, `src/app.ts`, `src/index.ts`, `lib/syncHealth.ts`, `lib/resilience.ts`  
**Parent:** [server-research-2026-09-19.md](server-research-2026-09-19.md)

This digs into **how the server actually works today**, with precise mechanics and implications for delta sync, scaling, and ops—not a second product roadmap.

---

## 1. Request body limits (two layers)

| Layer | Limit | Behavior |
|-------|--------|----------|
| Express `express.json` / `urlencoded` | **10mb** (`app.ts`) | HTTP 413 if exceeded (historic production failure mode when default ~100kb was used) |
| Application sanitize | **512 KB** aggregate after sanitize (`MAX_AGGREGATE_BYTES = 512 * 1024`) | `sanitizeSyncPayload` → `isSyncPayloadTooLarge` → **400** `"Payload too large"` on PUT |
| Post-merge cap | Same 512 KB target via `capMergedResult` | Trims bulk optional fields (`history`, templates, recipe presets, brand profiles, …) before giving up |

**Implication:** Raising Express to 10mb was necessary so the parser accepts the body; the **real product limit is 512 KB** of sanitized sync JSON. Delta sync is about staying comfortably under that application cap and reducing SSE frame cost—not about the 10mb parser ceiling.

**Caps inside the blob:**

| Constant | Value |
|----------|--------|
| `MAX_RUNS` | 50 |
| `MAX_LIST_ENTRIES` | 500 |
| `MAX_LIST_STRING_LEN` | 200 |
| Stamp namespaces / names | 50 / 500 |

Operational commands are also bounded (`MAX_COMMAND_ACTION_BYTES = 64 * 1024`).

---

## 2. Write path: `upsertProtected` (the critical transaction)

### 2.1 Order of operations (per attempt)

```text
db.transaction:
  1. Ensure dataReset row exists (onConflictDoNothing)
  2. SELECT dataReset FOR UPDATE          ← scope reset fence first
  3. If reset.epoch !== expectedEpoch → abort write (staleEpoch)
  4. SELECT daily_sync FOR UPDATE (date+scope)
  5. Merge:
       capPackagingManualOverrideUntil(payload, serverTime)  // max +60s from server clock
       protectRunValues(serverOwnedPayload, existing, {
         allowRunListReplacement: date > clientTodayDate   // scheduled future only
       })
       completeSyncData → canonicalizePepNames → applyResetBoundary
  6. UPDATE or INSERT daily_sync.data
  7. Return { data, wrote, canonicalRevision, serverTime }

outside transaction:
  detectConflicts(payload, existing, merged) → async recordSyncConflict
  (must not roll back the write if logging fails)
```

### 2.2 Concurrency

- Unique-violation on first insert → **retry up to 3 times** (lost race to create the day row).
- Reset epoch is locked **before** the day document so reset and sync cannot interleave incorrectly.
- **Today’s** run list is never wholesale-replaced by a client `resetAt` marker; only **future scheduled** dates may replace run lists (`allowRunListReplacement: date > clientTodayDate`).

### 2.3 Server-owned clamps

- **Packaging manual override:** client cannot set `manualOverrideUntil` more than **60s** ahead of server time (blocks indefinite auto-track suppression).
- **Pep name canonicalization** after merge.
- **Reset boundary** application for same-day vs scheduled semantics.

### 2.4 Deep-dive takeaway for delta sync

Any patch path must produce a **full candidate payload** that then enters this exact pipeline. Recommended shape:

```text
shadow[revision] + patch → apply → sanitize → size check
  → upsertProtected(fullCandidate) → broadcast(result)
```

Do **not** apply patches inside `protectRunValues`. Do **not** skip the reset-epoch `FOR UPDATE` fence.

**Revision note:** The snippet examined returns `existing?.canonicalRevision` in the write result path—confirm in-repo whether revision is incremented in SQL (`UPDATE … canonical_revision = canonical_revision + 1`) or elsewhere. Delta protocol design should key shadows off the **value clients actually receive** in PUT/SSE responses.

---

## 3. SSE: `/sync/events`

### 3.1 Client registration

```ts
type SseClient = {
  res: Response;
  clientId: string;
  scope: Scope;
  watchDate: string;           // facility calendar day
  resetEpoch: number;
  lastData: unknown;           // cached day payload for ticks (no extra DB on calc tick)
  lastCanonicalRevision: number;
  lastCalcEmitMs: number;
};
const clients = new Set<SseClient>();
```

- Close handler on **`res.close`** (not request close)—correct for long-lived SSE where the request may finish while the response stays open.
- Headers: `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `flushHeaders()`.

### 3.2 Initial frame (always)

Even when **no DB row** exists, the server sends a first frame with `emptySyncData` / complete shape. Clients must not upload local state before this baseline. Supports `snapshot` query for unchanged short-circuit.

Initial frame includes live state (`computeServerLiveState`) and reset/rollover flags when epoch &gt; 0.

### 3.3 Heartbeat + live calc ticks (two intervals)

| Timer | Default | Env override | Purpose |
|-------|---------|--------------|---------|
| Heartbeat | **15s** | `AUTO_TRACK_HEARTBEAT_MS` (min 1s) | May emit auto-track schedule + `heartbeat: true`, or SSE comment `: heartbeat` |
| Calc tick | **≥ 2s** | `LIVE_CALC_TICK_MS` | Active-run calc frame; else setup-form calc for selected run with values |

Calc ticks use **`client.lastData` only** (no DB read per tick). Authoritative cross-device updates still arrive via `broadcast` after writes. Idle days emit nothing extra on the calc timer.

### 3.4 Broadcast targeting

Broadcasts are scoped to clients on the **same facility calendar day** (`watchDate`) and scope—reduces cross-day noise when tablets straddle midnight incorrectly.

Special broadcasts: master-data invalidation families, reset, rollover.

### 3.5 Deep-dive takeaways

| Topic | Finding |
|-------|---------|
| Heartbeat | **Already implemented** at 15s—prior research “add heartbeat” is largely done; tune vs proxy idle timeouts |
| Multi-instance | In-process `Set` only—second API replica would not see peers’ SSE clients without a bus |
| Buffering | No `X-Accel-Buffering: no` in the examined handler—**add** if Caddy/nginx sits in front |
| Delta frames | Natural extension: after PUT, broadcast patch vs each client’s `lastCanonicalRevision`; full body on gap |
| Shutdown | `server.close` + 5s force exit; job/web-push/rollover schedulers stopped—**SSE clients** rely on connection close; consider explicit comment frame before close |

---

## 4. Database pool

```ts
// lib/db/src/index.ts
connectionTimeoutMillis: 900   // intentionally short
max: DATABASE_POOL_MAX || 10
pool.on("error", …)           // idle client errors swallowed; process stays up
```

**Design intent (from comments):**  
900ms acquisition timeout is **shorter** than some diagnostics deadlines so callers can fail over instead of queueing forever behind a saturated pool. Concurrency tests explicitly stress “pool pressure.”

**Deep-dive takeaways:**

| Check | Action |
|-------|--------|
| Host `max_connections` | Ensure `POOL_MAX × api_instances + admin + migrate` &lt; limit |
| SSE | Must not hold a checked-out client (current design is fine) |
| Transactions | `upsertProtected` holds `FOR UPDATE` only for merge duration—keep patch apply **outside** or **before** the transaction, not lengthening the lock with slow diff |
| keepAlive | Not set in the examined Pool config—consider `keepAlive: true` if idle disconnects appear on the host |
| statement_timeout | Not set at pool level in the examined snippet—consider DB or pool statement timeout for runaway queries |

---

## 5. Health vs sync health

| Endpoint / API | Role |
|----------------|------|
| `GET /livez` | Process alive only |
| `GET /readyz`, `/healthz`, `/` | Startup phase + DB `SELECT 1` + AI keys present + background workers not degraded |
| `buildSyncHealthReport` | Manager diagnostics: canonical document, revision, operational projection match, command/history integrity—**read-only, redacted, no repair** |

**Deep-dive product tension:** Readiness fails if AI provider env is missing. Floor sync does not need AI. Consider splitting “core ready” vs “AI ready” so a missing Gemini/OpenAI key does not take the plant offline at the load balancer.

Conflict stats route already aggregates 7-day conflict trends by field/run—useful input for conflict-visibility UX (Phase A3).

---

## 6. AI resilience (server library)

`lib/resilience.ts` (not the DB pool):

- Retry: max 3, exponential backoff + jitter, caps at 30s  
- Retryable: 429, 408, 5xx, timeout / ECONNREFUSED / ECONNRESET  
- `CircuitBreaker`: threshold 5 failures, 60s open → half-open

**Deep-dive:** Keep circuit state **out of** the sync request path. Sync should never await an AI call inside `upsertProtected`.

---

## 7. Graceful shutdown (current behavior)

On SIGINT/SIGTERM:

1. Stop server job worker, web-push scheduler, daily rollover scheduler  
2. `server.close` (stop new HTTP connections; wait for in-flight)  
3. Force `process.exit(1)` after **5 seconds**

**Gaps vs ideal SSE drain:**

- No explicit “server shutting down” SSE event  
- In-flight `upsertProtected` transactions should finish under `server.close` if they already started—verify under load  
- Pool is not explicitly `pool.end()` before exit (process exit reaps connections; cleaner for zero-downtime to end pool after close)

---

## 8. Concrete implementation checklist (server-side)

Derived only from this deep dive:

### P0 — Delta sync foundation

1. Accept optional JSON Patch body on `PUT /sync/today` and `PUT /sync/:date` when `Content-Type` / flag indicates patch.  
2. Load existing row (or shadow); `applyPatch`; on failure → 409/400 with instruction to full-sync.  
3. Feed reconstructed object through **existing** `sanitize → size → upsertProtected → broadcast`.  
4. Feature flag; default full-state.  
5. Emit logs: `sync.put.mode=full|patch`, byte lengths in/out, revision.

### P0 — Metrics (cheap)

- `sync_put_bytes`, `sync_put_runs`, `sync_sse_clients`, `sync_sse_frame_bytes` (sampled)  
- Compare against 512 KB app cap (not 10mb)

### P1 — SSE hardening

1. Set `X-Accel-Buffering: no` (and document Caddy `flush_interval` / proxy buffering).  
2. Confirm host idle timeout **&gt; 15s** heartbeat (prefer 60s+).  
3. Optional shutdown comment frame to all `clients` before `server.close`.

### P1 — Pool / deploy

1. Document recommended `DATABASE_POOL_MAX` for current Render plan.  
2. Evaluate `keepAlive: true` and statement timeout.  
3. Ensure migrate job never shares the serving pool sizing assumptions.

### P2 — Readiness semantics

1. AI key absence → degraded diagnostics, not necessarily 503 for whole API (product call).  
2. Optional `GET /api/sync/health` already conceptualized via `syncHealth.ts`—wire to route if not already exposed for managers.

### P2 — Revision contract

1. Document whether `canonicalRevision` increments on every successful write and what clients store.  
2. Optional request header/body `baseRevision` for strict patch apply (`test` op).

---

## 9. What not to change without new evidence

- In-process SSE fanout (correct until multi-instance API)  
- Reset-epoch-before-document lock order  
- Conflict logging **outside** the write transaction  
- 512 KB application cap (tighten with metrics; don’t silently raise)  
- Server clamp on packaging manual override (security/correctness)  
- Calc tick using cached `lastData` (intentional; keeps pool free)

---

## 10. Open questions for a follow-up code pass

1. Exact SQL for `canonicalRevision` increment on UPDATE—needed for patch shadow correctness.  
2. Whether `broadcast` updates each client’s `lastData` / `lastCanonicalRevision` (required for calc tick + future patch frames).  
3. Presence of `GET` route exposing `buildSyncHealthReport` to authenticated managers.  
4. Caddy/Render proxy config in-repo for SSE buffering and timeouts.

---

## Document maintenance

- Re-verify line-level claims after large `sync.ts` refactors.  
- When delta sync lands, append measured patch ratios (case-tick vs recipe-import) here.  
- Link production proxy timeout values into `.agents/memory/` once confirmed.
