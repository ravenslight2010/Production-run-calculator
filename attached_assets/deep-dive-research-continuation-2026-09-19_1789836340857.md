# Deep-Dive Research Continuation

**Date:** 2026-09-19  
**Branch reviewed:** `Replit` @ `191fca40` (also cross-checked against local `sync.ts` / `home` paths)  
**Builds on:** sync deep dive, reconnect reliability deep dive, server research, Replit `research/*`

This note **verifies claims with code**, folds in the Replit agent’s evidence-graded research, and names the next experiments that actually move risk down.

---

## 1. Executive findings (verified)

| # | Finding | Confidence | Evidence |
|---|---------|------------|----------|
| 1 | **Ordinary day-state PUT does not increment `canonicalRevision`** | High | `upsertProtected` UPDATE sets `data` only; returns `existing?.canonicalRevision ?? 0` — no `+ 1` |
| 2 | **`canonicalRevision` does increment on operational-intent paths** | High | Multiple intent/ledger handlers: `(existing?.canonicalRevision ?? 0) + 1` then persist |
| 3 | **Partial PUTs are causally fenced; complete PUTs are not** | High | Partial: lock → `baseSnapshotId` must match → else `partialFallback`. Complete: straight into `protectRunValues` |
| 4 | **Client sends partial when a canonical snapshot exists** | High | `completeness: canSendPartial ? "partial" : "complete"` + `baseSnapshotId: syncSnapshotIdRef.current`; omits unchanged `runValues` by stamp equality |
| 5 | **Per-run LWW uses client wall-clock stamps** | High | Strict `incoming stamp > stored` in `protectRunValues`; not proof of causality |
| 6 | **Empty form + real stamp is a known wipe class** | High | Client push path explicitly guards: never push all-default current-run form over populated storage (recurring “vanished after refresh”) |
| 7 | **Revision is not a complete-write precondition today** | High | Replit claim assessment: *contradicted* that complete writes are protected by revision |

**Implication:** Even if the client always sent `baseRevision`, **today’s day-state write path does not advance revision**, so peers cannot use revision alone to order ordinary form edits. Operational commands and day-state blobs are on **different causality tracks**.

---

## 2. Causality model (as implemented)

```text
                    ┌─────────────────────────────┐
   Form / setup     │  daily_sync.data            │
   partial/complete │  LWW via runValuesUpdatedAt │
   PUT ────────────►│  canonicalRevision UNCHANGED│
                    └──────────────┬──────────────┘
                                   │ SSE full frame
                                   ▼
                    ┌─────────────────────────────┐
   Lifecycle cmds   │  intent ledger + day merge  │
   POST intent ────►│  canonicalRevision += 1     │
                    └─────────────────────────────┘
```

**Partial path (safe sparse update):**

```text
lock reset + row
if partial and baseSnapshotId != hash(locked row):
    return complete snapshot, wrote=false, partialFallback
else:
    candidate = { ...locked, ...sparse }
    protectRunValues(candidate, locked)
    write data  // revision unchanged
```

**Complete path (stamp-dominated):**

```text
lock reset + row
protectRunValues(completePayload, locked)  // no base check
write data  // revision unchanged
```

**Reconnect overwrite class (still open as production proof, closed as design risk):**

```text
Device B offline holds old values, later local stamp T_high
Device A online writes newer real state with stamp T_mid < T_high
B reconnects with complete (or partial that includes that run) stamp T_high
→ LWW accepts B’s old values
```

Partial helps only when B **omits** the run (stamp equal to baseline). If B “edited” offline or stamp advanced without adopting A, the run is included and can win.

---

## 3. What Replit research added (graded)

From `research/reconnect-causality-research.md` and related notes:

| Claim | Their label | Our stance |
|-------|-------------|------------|
| Foreground recovery blocks pre-adopt push | Verified | Agree (tests + code) |
| Partial cannot apply on stale base | Verified | Agree |
| Complete writes protected by revision | **Contradicted** | Agree — and revision often **doesn’t even move** on day PUT |
| Client timestamps = causal order | Unsupported | Agree |
| Future-skewed stale complete can overwrite | Partially verified | Agree — needs disposable integration test |
| Specific production incident = clock skew | Needs human | Agree — need sanitized metrics, not guesses |
| Adopt HLC immediately | Unsupported | Agree — base fence first; HLC later if still needed |

**Deploy (Replit SSE gap):** Autoscale scale-to-zero / multi-server is documented; **do not** claim Replit “forbids SSE.” Treat process-local `clients` Set + multi-instance as a **compatibility risk** until sticky sessions or a bus exist. Reserved VM language fits always-on SSE better than Autoscale assumptions.

---

## 4. Client partial builder (detail)

When `canSendPartial` is true:

- Payload marked `syncVersion: 1`, `completeness: "partial"`, `baseSnapshotId` from last adopted snapshot  
- For each non-pristine run: include `runValues[id]` only if local stamp ≠ baseline stamp **or** current form differs from stored  
- Packaging progress included if present  
- History included only if signature changed  
- Master lists / profiles **not** in day-state payload (factory KV / profile sync)

**First connection / no snapshot:** complete payload (no base). That is the highest-risk write class after long offline.

**Empty-form guard:** If form is still defaults during handoff but storage has real values, push storage—not empty—so equal stamps don’t accept empty and wipe the plant.

---

## 5. Research directions worth doing next

### 5.1 Disposable proof test (highest leverage)

Add to API sync integration suite (no production data):

1. Seed day with run R values V1, stamp 1000.  
2. Complete PUT from “stale” client: values V0, stamp 5000.  
3. **Today:** expect V0 wins (documents the hole).  
4. **After fix:** expect reject or retain V1.

Also: partial with wrong `baseSnapshotId` → `partialFallback`, data unchanged (already largely covered).

### 5.2 Protocol options (compare, don’t implement all)

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **A. Complete-write baseSnapshotId** | Same as partial; mismatch → no apply | Small change; reuses hash | Hash of full doc is CPU-heavy; clock stamps still merge inside same base |
| **B. baseRevision on all writes + increment on day PUT** | `canonicalRevision += 1` on successful day write; client must send base | Cheap integer compare; aligns intents + day-state | Requires client adopt discipline; migration for old clients |
| **C. Server stamp clamp** | Reject/clamp stamp > serverNow + skew | Stops year-2027 clocks | Doesn’t stop offline-later-real-stamp clobber |
| **D. Rebase-only after wake** | Never complete-push until adopt; only partial residue | Matches product intent | Doesn’t stop malicious/legacy client |
| **E. HLC / Lamport** | True causality | Strong theory | High cost; premature before A/B |

**Recommended sequence:** Test (5.1) → **B + A** together (increment revision on day write + require base on complete) → **C** as belt-and-suspenders → measure false rejects → only then consider E.

### 5.3 Faster trusted baseline (ops research)

Separate from causality:

1. **Time-to-baseline histogram** — `reconnect.baseline_ms` from wake start to adopt complete.  
2. **Proxy** — confirm buffering off; idle timeout > 15s heartbeat.  
3. **Split recovering UX** — day-state adopt vs profiles/factory.  
4. **Deploy topology** — single always-on instance vs Autoscale; document SSE fanout assumption.

### 5.4 Observability (minimal, privacy-safe)

Counters only (Replit research list is good):

```text
reconnect.baseline_ms
reconnect.push_suppressed
reconnect.queued_discarded_generation
sync.complete_write_without_base
sync.partial_fallback
sync.future_stamp_candidate   // stamp > serverNow + 60s
sync.day_put_revision_unchanged  // temporary: always true until fixed
```

No payloads, no run IDs in logs.

### 5.5 Pool / readiness (from Replit research)

- Keep short acquisition timeout (900ms) intentional.  
- Size `DATABASE_POOL_MAX` vs host `max_connections` and instance count.  
- AI missing → **degraded** vs **not ready** is still a product policy decision; floor sync should not depend on GenAI keys.

---

## 6. Proposed “definition of done” for the overwrite class

A fix is done when:

1. Integration test: future-stamped stale **complete** write cannot replace newer plant values.  
2. Every successful day-state write either:  
   - advances `canonicalRevision`, or  
   - is explicitly revision-neutral with another documented causality token.  
3. Complete writes declare a base (snapshot or revision); mismatch → authoritative complete response, `wrote=false`.  
4. Client after wake: only partial residue against **post-adopt** base.  
5. Metrics show partial_fallback and complete_without_base rates in staging.

---

## 7. Open questions (still need evidence)

1. Production rate of **complete** vs **partial** PUTs after first baseline.  
2. Whether any client path still complete-pushes after snapshot exists (bug or intentional).  
3. Host max connections and whether pool saturation correlates with slow wake.  
4. Actual deploy target (Render vs Replit Reserved vs Autoscale) for production SSE.  
5. Sanitized incident: snapshot hashes + stamp skew bucket for a real overwrite report.

---

## 8. Document map

| Artifact | Role |
|----------|------|
| This file | Verified continuation + experiment plan |
| Replit `research/reconnect-causality-research.md` | Claim grading + test matrix design |
| Replit `docs/reconnect-reliability-deep-dive-2026-09-19.md` | Condensed product-facing reconnect doc |
| `sync-deep-dive-2026-09-19.md` | Full sync architecture |
| `server-research-deep-dive-2026-09-19.md` | SSE/pool/txn |

---

## 9. Suggested next deep-dive slices (pick one)

1. **Implement the stale-complete regression test** on a disposable DB (proof).  
2. **ADR: increment `canonicalRevision` on day-state write** + client `baseRevision` wire field.  
3. **Deploy topology decision record** (SSE + single instance).  
4. **Field-level contention map** — which FormValues keys multi-station edit (narrow LWW units).

---

*Research posture: prefer disposable tests and counters over expanding narrative docs until the complete-write hole is closed or disproved.*
