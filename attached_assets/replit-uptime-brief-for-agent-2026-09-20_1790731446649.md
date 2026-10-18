# Uptime brief for Replit agent — Lucia’s Production Assistant

**Audience:** Replit coding agent / deploy operator  
**Site:** https://lucias-production-assistant.replit.app/  
**Repo branch:** `Replit` (same readiness code as `main`)  
**Date of live probe:** 2026-09-20 ~19:48 UTC  
**Goal:** Keep the floor app up reliably; stop intermittent “down more than up.”

---

## 1. Live probe results (was healthy at probe time)

| Endpoint | HTTP | Body summary |
|----------|------|----------------|
| `GET /api/livez` | 200 | `{"status":"ok","probe":"liveness"}` |
| `GET /api/readyz` | 200 | All checks `ok` (see below) |
| `GET /` | 200 | Calculator HTML served |
| `GET /api/sync/today` (no cookie) | 401 | `session_expired` (expected) |

**readyz checks at probe:**

```json
{
  "status": "ok",
  "checks": {
    "process": "ok",
    "startup": "ok",
    "database": "ok",
    "dependencies": "ok",
    "backgroundWorkers": "ok"
  }
}
```

**Background diagnostics (ok):** daily-rollover, server-job-run, web-push-schedule recent success; server-job-prune older but under failure threshold.

**Latency:** readyz ~0.23s (warm instance).

**Conclusion of probe:** Not stuck in permanent “AI missing” or “never finished startup” right now. Secrets and DB were fine at probe time. Intermittent downtime is still explained by **Autoscale + strict readiness + client sync**, not by a currently red check.

---

## 2. Deploy config that hurts uptime

From `.replit` on branch `Replit`:

```toml
[deployment]
router = "application"
deploymentTarget = "autoscale"
```

**Problem:** Autoscale is a poor fit for this app:

- Scale-to-zero / cold starts → users see “not live,” long waits, or failed loads after idle.
- Possible multi-instance routing → **in-process SSE** (`clients` Set in API) does not fan out across instances; tablets look “disconnected” or stale.
- Floor app needs **always-on**, not scale-to-zero.

**Preferred deploy change:**

- Switch deployment to **Reserved VM** (or equivalent always-on), not Autoscale.
- Keep a single instance until a real pub/sub or sticky SSE story exists.

---

## 3. Readiness code (same on Replit and main)

**File:** `artifacts/api-server/src/routes/health.ts`

| Path | Role |
|------|------|
| `/api/livez` | Process only — always ok if Node is up |
| `/api/readyz`, `/api/healthz`, `/api/` | **Strict readiness** — any failed check → **HTTP 503** |

**Checks that must all be `ok` for 200:**

1. **startup** — `getStartupHealth().phase === "ready"`  
   Fails if `seed_roles` or `data_heals` failed after listen (`artifacts/api-server/src/index.ts`).
2. **database** — `SELECT 1` after startup ready.
3. **dependencies** — requires  
   `process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.OPENAI_API_KEY`  
   else `detail: "ai_provider_not_configured"`.
4. **backgroundWorkers** — fails if sustained background failures  
   (≥ **3** failures in **5 minutes** per `backgroundOperations.ts`)  
   for: `daily-rollover`, `server-job-run`, `server-job-prune`, `web-push-schedule`.

**Product mismatch:** Core floor features (auth, day-state sync, live calc) do **not** need Gemini. Failing deploy/platform health because AI is unset or flaky is wrong for this product.

**Pool:** `lib/db` — `connectionTimeoutMillis = 900`, `max = DATABASE_POOL_MAX || 10`. Idle client errors are logged, not process-killing.

---

## 4. What to change (priority order)

### P0 — Deploy: always-on

- [ ] Set deployment target to **Reserved VM** (always-on), not Autoscale.
- [ ] Confirm one instance for SSE correctness until a cross-instance bus exists.
- [ ] After change: idle 30+ minutes, then `curl` livez/readyz still 200 quickly.

### P0 — Code: soft readiness for AI and background

In `artifacts/api-server/src/routes/health.ts` (and tests):

**Keep hard-fail (503) for:**

- startup not ready  
- database unreachable  

**Do not hard-fail (prefer warning / still 200) for:**

- AI provider missing or optional  
- backgroundWorkers degraded  

Suggested shape:

```text
allHealthy for HTTP 200 =
  startup ok AND database ok

checks.dependencies =
  ai configured ? ok : warning  // or ok with detail ai_optional

checks.backgroundWorkers =
  degraded ? warning : ok

// Optional: include checks in JSON either way
// Only return 503 when startup or database is bad
```

Also add/adjust unit or route tests so missing AI key does **not** yield 503 when DB is up.

### P1 — When down, capture evidence

```bash
curl -sS -i https://lucias-production-assistant.replit.app/api/livez
curl -sS -i https://lucias-production-assistant.replit.app/api/readyz
```

| livez | readyz | Meaning |
|-------|--------|---------|
| fail | fail | Process/edge/cold — scale-to-zero or crash |
| 200 | 503 | Read body `checks` + `startup.errorCode` |
| 200 | 200 | Platform up — look at session/sync/SSE client |

### P1 — Do not require AI for “app up”

- Keep AI secrets set if features are used (probe showed dependencies ok).  
- Still implement soft readiness so a rotated/missing key cannot take the whole site offline.

### P2 — SSE + single instance

- Document: one always-on instance until SSE is backed by Redis/pubsub or sticky sessions are guaranteed.
- Client already has wake/reconnect logic; server multi-instance still drops live updates.

---

## 5. Startup failure modes (if readyz shows startup error)

From `artifacts/api-server/src/index.ts`:

```text
listen → database_schema → seed_roles → data_heals → markStartupReady
         → start auto-track ticks + daily-rollover + web-push + server-job worker
```

If `seed_roles` or `data_heals` throws → `markStartupFailed` → **readyz 503 until fixed + restart**.

Check logs for:

- `seed_roles_failed`
- `data_heals` + repair id / errorCode  
- `database_unreachable`

---

## 6. Explicit non-goals for this brief

- Do not rewrite sync LWW / partial protocol in this task (separate research).  
- Do not switch to WebSockets unless measured need.  
- Do not run down-migrations.  
- Do not treat “Published your App” checkpoint commits as product fixes.

---

## 7. Acceptance criteria

1. Reserved VM (or always-on) deployment; no scale-to-zero for production.  
2. `GET /api/readyz` returns **200** when DB up and startup complete **even if AI env is unset** (after code change).  
3. `GET /api/readyz` returns **503** only when startup not ready or database unreachable (after code change).  
4. Background worker failures alone do not 503 readiness.  
5. After 30 minutes idle, first `livez`/`readyz` succeed without manual republish.  
6. Existing tests updated; release/API health tests still pass.

---

## 8. Quick reference — files to touch

| File | Change |
|------|--------|
| `.replit` | `deploymentTarget` → reserved / always-on (per Replit product name) |
| `artifacts/api-server/src/routes/health.ts` | Soft AI + background; hard DB + startup only |
| Health/route tests next to health or API integration | Assert 200 without AI key |
| Optional: env `READINESS_REQUIRE_AI=1` | Escape hatch for strict deploys only |

---

## 9. One-paragraph summary for the agent

The published app at https://lucias-production-assistant.replit.app/ was **healthy on 2026-09-20 probe** (livez and readyz 200, all checks ok). Intermittent downtime is still expected while **`deploymentTarget = "autoscale"`** (cold start / not-live) and while **readyz hard-requires AI and background workers**. Fix deploy to **always-on (Reserved VM)**, and change **health.ts** so only **startup + database** fail readiness with 503; treat AI and background as warnings. Re-probe livez/readyz after idle to confirm.

---

*End of brief — safe to paste into Replit agent as the task definition.*
