# Replit Handoff — Readiness, SSE, QC (2026-10-03)

**Branch:** `Replit` @ `3412b790` (or newer tip)  
**Production:** https://lucias-production-assistant.replit.app  
**Role of this note:** Owner-verified status + bounded next work. Do not expand scope beyond the tasks below without owner approval.

---

## Verified live status (probed 2026-10-03)

| Probe | Result |
|-------|--------|
| `GET /api/livez` | **200** — liveness ok |
| `GET /api/readyz` | **200** — `status: ok` |
| Soft readiness policy | **Deployed** — AI and background-worker problems do **not** block readiness |

**Core ready (must stay hard):** startup + database + auditProtection only.  
**Optional (warning only):** AI not configured, sustained background worker failures.

**Non-blocking production noise:**

- `web-push-schedule`: `warning` — 5 recent failures (threshold 3), code `operation_failed`
- `daily-rollover`: occasional single `operation_failed` under threshold

Do **not** reintroduce hard-fail on AI or workers. Preserve route tests that assert warning → HTTP 200 and required-failure → HTTP 503.

---

## Task 1 — Web-push worker noise (P1 cleanup)

**Goal:** Reduce or eliminate `web-push-schedule` sustained failures so diagnostics stay clean.

**Do:**

1. Inspect only sanitized logs / diagnostics for `web-push-schedule` (no secrets in commits).
2. Common causes: missing/invalid VAPID keys, expired subscriptions, push endpoint 410, network to push service.
3. Prefer: prune dead subscriptions, handle 410, backoff, and keep failures from accumulating above threshold when expected (e.g. no subscribers).
4. Re-probe `/api/readyz` — expect `backgroundWorkers: ok` or transient warning only.

**Do not:** Block readiness on web-push; store raw PII endpoints in docs.

**Done when:** Documented root cause (sanitized) + either fix merged or explicit “accept warning” owner note; probe shows improved counts.

---

## Task 2 — Purge-all must not wipe QC evidence (P1)

**Problem:** `POST /sync/purge-all` still deletes `qualityChecksTable` (listed in `scopedTables` in `artifacts/api-server/src/routes/sync.ts`). Factory purge should not destroy quality/compliance history.

**Do:**

1. Remove `qualityChecksTable` from the purge-all delete list (scoped and global).
2. Update the handler comment: QC / quality history **survives** purge-all; daily reset never touched it.
3. Add an integration or route test: insert a quality check for the scope → purge-all → row still present; a normal scoped master-data table is cleared.
4. When future QC tables land (`run_lots`, `weight_checks`, `qc_audit_log`, holds), keep them off purge lists by policy.

**Do not:** Add a silent “wipe QC” into purge-all. If a true QC-wipe is ever needed, it must be a **separate**, capability-gated, explicitly named endpoint.

**Done when:** Test green + comment accurate + no `qualityChecksTable` in purge delete arrays.

---

## Task 3 — SSE / Autoscale decision (P1 product + eng)

**Fact:** `/sync/events` clients live in a **process-local** `Set` in `sync.ts`. Broadcasts do not cross Node processes. No shared Redis/pg_notify broker in this path.

**Autoscale implication:** Write on instance A does not immediately fan out to SSE clients on instance B. Reconnect/heartbeat can recover canonical state; live peer updates are not guaranteed multi-instance.

**Owner must choose one (do not implement both):**

| Option | Work | When |
|--------|------|------|
| **A. Single always-on API process** | Enforce/document min instances = 1 (or equivalent); accept no scale-out for API | Prefer simple live SSE, accept single failure domain |
| **B. Shared fanout** | Add cross-process event path + two-process tests for day-state, lock, reset, rollover, master-data invalidate | Need Autoscale multi-instance **and** immediate peer updates |

**Until decided:** Do not change deployment topology. Do not claim sticky sessions fix this (not guaranteed).

**Engineering after owner picks A or B:**

- **A:** Verify platform constraint; document in `docs/release-operations.md` (or equivalent).
- **B:** Design shared fanout + tests; connection-pool budget vs max instances; no silent message loss.

**Done when:** Owner choice recorded in a short decision note + matching verification (constraint check or shared-fanout design approved).

---

## Task 4 — QC Phase 1 (only after product decisions) (P2)

**Current:** Schema has `qualityChecks` only. No `run_lots`, `weight_checks`, `qc_audit_log`, `product_holds`, or `line_clearances`. Plan remains in `docs/qc-department-plan.md`.

**Do not build the full QC department until owner confirms:**

1. Required checks (lots, weights, labels, holds?)  
2. Who may write / release (capabilities)  
3. Retention and purge rules (align with Task 2)  
4. Whether hold can block complete-run / ship signals  

**If owner approves a minimal Phase 1, preferred order:**

1. Purge exclusion already shipped (Task 2)  
2. Tables: `run_lots`, `weight_checks`, optional `qc_audit_log` (append-only)  
3. OpenAPI + `qc` routes (GET/POST by `runId`)  
4. Dashboard slice under existing QC UI  
5. Optional later: `product_holds`, line clearance, finished-lot identity  

**Industry note (for product, not scope creep):** Hold/release and label checks matter as much as weights for real plant QC; import-approval queue can wait.

**Done when:** Owner-signed scope note exists; if building, schema + routes + purge survival tests pass.

---

## Explicit non-goals for this handoff

- QLoRA / local model training promotion  
- Changing Autoscale geography or publish for curiosity  
- Full HACCP document control inside the app  
- Mobile parity / physical-device-only work  
- Rewriting soft readiness back to hard-fail on AI  

---

## Acceptance checklist (copy into task tracker)

- [ ] Production `/api/readyz` remains 200 when only workers warn  
- [ ] Web-push failure cause identified (sanitized) and mitigated or accepted  
- [ ] `quality_checks` excluded from purge-all + test  
- [ ] Owner chooses SSE Option A or B; decision recorded  
- [ ] QC Phase 1 either deferred with written reason or scoped and started after Task 2  

---

## References on branch

- `artifacts/api-server/src/routes/health.ts` — soft readiness  
- `artifacts/api-server/src/routes/sync.ts` — SSE `clients` Set; purge-all table list  
- `docs/uptime-and-operational-backlog-decision-2026-10-02.md`  
- `docs/qc-department-plan.md`  
- `lib/db/src/schema/qualityChecks.ts`  

---

*Handoff prepared 2026-10-03 from live probes + Replit tip review. Primary branch is Replit; main is experimental.*
