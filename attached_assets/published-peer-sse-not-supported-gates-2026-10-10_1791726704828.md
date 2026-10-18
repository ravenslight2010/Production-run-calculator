# Published Live Peer SSE — NOT_SUPPORTED Gates

**Date:** 2026-10-10  
**Branch:** `Replit`  
**Status:** Design approved and implemented; **published** live peer SSE still **NOT_SUPPORTED**

---

## 1. Policy timeline

| Date | Decision |
|------|----------|
| 2026-10-03 | Owner chose **SSE Option A** (single always-on API process; no shared fanout) |
| 2026-10-10 | Owner **reversed**: keep **Autoscale**, require immediate cross-process peer updates, approve **PostgreSQL outbox + LISTEN/NOTIFY** |
| 2026-10-10 | Implementation + isolated 2-process verification landed |
| Ongoing | Agent memory and evidence keep **`livePeerSseSupported: false`** until capacity + topology gates clear |

Source: `.agents/memory/sse-topology-choice.md`

---

## 2. What is already true

| Claim | Evidence |
|-------|----------|
| Outbox + LISTEN design implemented | `syncOutbox.ts`, schema, `sync.ts` dispatch |
| Isolated cross-process fanout works | `docs/evidence/sync-peer-fanout-2026-10-10.json` — **VERIFIED** (7 tests, 2 API processes) |
| Production `/readyz` can be healthy | Topology observation probes 200 |
| Local (same-process) SSE still works | Process-local `clients` Set + local `broadcast` |

---

## 3. Official conclusions (do not over-claim)

### `docs/evidence/sync-peer-fanout-2026-10-10.json`

```json
"conclusion": {
  "isolatedCrossProcessFanout": "VERIFIED",
  "publishedLivePeerSse": "NOT_SUPPORTED"
}
```

Limitations called out: isolated fixture only; does **not** prove Autoscale process limits or peak DB capacity.

### `docs/evidence/sse-topology-observation-2026-10-10.json`

```json
"conclusion": {
  "isolatedCrossProcessFanout": "VERIFIED",
  "publishedLivePeerSseSupported": false,
  "status": "DESIGN APPROVED; SUPPORT BLOCKED BY CAPACITY AND DEPLOYED-TOPOLOGY VALIDATION",
  "reason": "The deployed revision and sampled primary database capacity are verified, but Autoscale maximum/current/peak API-process counts and provider-reserved slots remain unknown. The observed sample window does not establish representative peak headroom, and cross-instance behavior was not tested on a non-production deployment."
}
```

### Product language

| Safe to say | Not safe to say |
|-------------|-----------------|
| Shared fanout is implemented and unit/integration verified in isolation | “Production Autoscale guarantees instant multi-instance tablet updates” |
| Same-instance peers get SSE as before | “Live peer SSE fully supported” without new evidence |

---

## 4. Gate checklist

| ID | Gate | Current state | Clear when |
|----|------|---------------|------------|
| **G1** | Autoscale **current / max / peak** API process counts | `null`; `servingProcessEvidence.evidenceAvailable: false` | Authoritative settings or metrics show max and observed peaks |
| **G2** | Always-on vs scale-to-zero | Autoscale may scale to 0; not proven always-on | Min instance policy documented **or** cold-start accepted in ops docs |
| **G3** | **Peak** connection headroom | Samples exist; `representsPeakHeadroom: false` | Peak-shift samples under multi-tablet load including **+1 LISTEN conn/process** |
| **G4** | Provider **reserved** connection slots | `unknown` | Provider reserve known so “slots remaining” is real |
| **G5** | Non-production topology validation | `status: not_run` | Staging Autoscale with ≥2 processes runs fanout suite |
| **G6** | Deployed cross-instance proof | Only disposable isolated test | Staging or controlled prod-class dual process proof |
| **G7** | Published **revision binding** | Observation must match live `build-info` | Fingerprint/commit on live deploy matches support evidence |

---

## 5. Capacity snapshot (informative only)

From production observation samples (not peak-certified):

| Metric | Sampled value |
|--------|----------------|
| Postgres `max_connections` | ~450 |
| Known superuser reserves | 4 |
| Client backends range | ~6–13 |
| Per-process pool max | 10 |
| Sampled pool total | ~3–10 |
| Highest pool waiting in samples | 2 (not certified peak) |
| Autoscale current/max processes | **unknown** |

Large apparent free slots are **not** sufficient while process count ceiling is unknown.

---

## 6. Recommended path to flip support bit

1. **Staging Autoscale** with minimum **2** API processes.  
2. Run the isolated sync convergence / peer-fanout suite **against that deploy** (clears G5/G6).  
3. Capture **peak** window: process count, pool total/waiting, client backends, LISTEN connections (G1–G4).  
4. Bind evidence to live `/api/build-info` source revision + fingerprint (G7).  
5. Update:
   - `.agents/memory/sse-topology-choice.md`
   - release / ops notes  
   - only then claim **published live peer SSE supported** with dated evidence JSON.

Optional owner waiver: accept residual risk and document “best effort under Autoscale” without full G1–G7 — still should not silently imply hard guarantees.

---

## 7. Related files

| Path | Role |
|------|------|
| `.agents/memory/sse-topology-choice.md` | Owner decision + support limits |
| `docs/evidence/sync-peer-fanout-2026-10-10.json` | Isolated fanout verification |
| `docs/evidence/sse-topology-observation-2026-10-10.json` | Production observation + capacity gaps |
| `release-evidence/sse-topology-observation-2026-10-09.json` | Earlier observation / owner decision snapshot |
| `artifacts/api-server/src/lib/syncOutbox.ts` | Implementation |
| Companion doc | `sync-outbox-wiring-deep-dive-2026-10-10.md` |

---

## 8. One-line summary

**Code and isolated tests for cross-process fanout are in; production Autoscale live peer SSE remains intentionally NOT_SUPPORTED until process topology and peak DB budget are evidenced.**

---

*Gates doc compiled 2026-10-10 from Replit evidence and agent memory.*
