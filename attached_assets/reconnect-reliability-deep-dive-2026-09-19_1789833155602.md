# Deep Dive: Faster, Safer Reconnect (and Stopping Stale Overwrites)

**Date:** 2026-09-19  
**Problem statement:** Reconnect sometimes feels slow or flaky. During reconnect, **old local data can overwrite newer server/peer data** because the offline device’s stamps look “newer.”  
**Primary code:** `useHomeSyncCoordination.ts`, `synchronizationStateMachine.ts`, `home.tsx` (`applySync` / `schedulePush` / wake recovery), `sync.ts` (`protectRunValues`, partial base validation), packaging/run stamp registers  

---

## 1. What users experience

| Symptom | Likely mechanism |
|---------|------------------|
| Long “Still recovering…” after screen wake | Foreground barrier held until GET `/sync/today` (or SSE baseline) adopts |
| Tab comes back online and “undoes” another station’s work | Offline/stale device pushes with **higher `runValuesUpdatedAt`** (or lifecycle stamps) than server |
| Two tabs fight / “keeps resetting” | Periodic/reconnect re-push of unchanged-but-stale payload (mitigated by signature skip; still fragile if sig differs) |
| Slow first paint of live numbers | Waiting on full SSE initial frame + merge before releasing auto-track |

The product already has extensive fencing. Failures are usually **ordering** (push before adopt) or **stamp causality** (client wall-clock stamps vs server authority), not “no sync at all.”

---

## 2. Intended reconnect design (current)

### 2.1 Connection establishment

```text
Mount / date change
  → connectSse() EventSource(/api/sync/events?…)
  → onopen → connected
  → first message with initial baseline
       → applySync(payload, { initialSnapshot: true })
       → state machine completeInitialSnapshot()
       → onInitialBaseline(shouldPush)
            → if wake barrier up: queue push (do not race)
            → else schedulePush
```

`useHomeSyncCoordination.connectSse`:

- Builds `EventSource` with client id + snapshot query  
- Ignores callbacks after `close()` (queued WebKit deliveries)  
- Date-interval reconnect when facility calendar day changes  
- Online / visibility → shared **foreground recovery** (wake guard)

### 2.2 Wake / visibility recovery

```text
visibility visible | focus | online
  → beginWake()  // generation++
  → foregroundSyncBarrier = true
  → block auto-track
  → abort in-flight push generation
  → GET /api/sync/today (+ snapshot short-circuit)
  → adopt (lifecycle durable → general merge → profiles/factory)
  → completeWake(success)
  → release barrier; optional push of post-adopt local residue
```

Institutional rules:

- **Adopt before publish**  
- Cancelled recovery **discards** queued pre-wake write so next owner cannot publish stale mutations  
- Auto-track claims wait for monotonic recovery acknowledgement  

### 2.3 Push path safeguards already present

- Single-flight queue; newer local snapshot replaces queue  
- Skip push when payload signature equals last acked (`lastSyncSigRef`) — stops idle tab clobber  
- Baseline gate: no push until initial snapshot accepted  
- During `waking` / `resetting`, pushes deferred  

### 2.4 Receive-side LWW (client)

Comments in `home.tsx` encode the lost-update rule:

- Compare **per-run** `runValuesUpdatedAt`  
- Reject remote values only when local stamp is **strictly newer**  
- Equal stamps (including both `0`) → adopt remote  
- Packaging progress is a **separate** causal register (overlay) so auto-track cannot restore pre-correction skids  
- Date/reset fence: wrong-day or older `resetAt` must not advance packaging/day  

Server `protectRunValues` applies the same family of rules under a row lock.

---

## 3. Root cause: why “old data wins”

### 3.1 Client-authored timestamps as truth

Stamps (`runValuesUpdatedAt`, packaging stamps, lifecycle meta stamps) are largely **device wall-clock** (or “last local edit time”). Classic offline-first failure:

```text
Station A (authoritative work, 10:00 server time) → server has state S_new
Station B offline since 09:50, local stamp 10:05 (clock skew or late local edit)
B reconnects → push with stamp 10:05
Server LWW: 10:05 > stored stamp → S_old overwrites S_new
```

Even without skew:

```text
B edited offline after A’s change but B never saw A
B’s stamp is later → B wins entire run blob → A’s field changes lost
```

Coarse whole-run LWW amplifies damage: one stamp often covers the entire `FormValues` object.

### 3.2 Reconnect ordering races (when fences slip)

| Race | Effect |
|------|--------|
| Push scheduled from `onInitialBaseline` while barrier not yet raised | Pre-wake local blob hits server before GET adopt |
| SSE `initial: true` on **reconnect** treated like first-ever seed | Wholesale adopt vs offline New Run confusion (partially guarded by `shouldAtomicallyAdoptFirstSnapshot`) |
| Retry storm after 5xx | Retries of **pre-adopt** payload if generation not bumped |
| Signature differs after local-only bookkeeping | “Unchanged” skip fails → stale full document re-broadcast |

### 3.3 SSE still full-document to peers

Partial PUT reduces **upload** size; peers still receive complete frames. A single bad LWW win propagates to every tablet quickly.

### 3.4 Industry pattern

LWW on client clocks is known-fragile (clock skew, delayed sync, coarse fields). Mature systems use:

- **Server revision / sequence** as authority for “what is current”  
- Client stamps only for **merge hints** within same base revision  
- Or hybrid logical clocks; or field-level CRDTs for concurrent edits  

This app already has `canonicalRevision`, `baseSnapshotId` (partial), and operational-intent **server ledger**—but ordinary form pushes still primarily resolve via client stamps.

---

## 4. Making connection **faster**

Goal: time-to-trusted-baseline ↓ without allowing unsafe publish.

| Change | Why it helps | Risk |
|--------|--------------|------|
| **HTTP baseline before or parallel to SSE** | GET `/sync/today` is enough to adopt; don’t wait for EventSource open on slow proxies | Must still open SSE for live; dual path must share one apply generation |
| **Snapshot short-circuit aggressively** | `?snapshot=` → `{ unchanged: true }` skips body parse | Client must trust local only if snapshot still matches after wake |
| **Prefer GET on wake; treat SSE as streaming delta after** | Wake path already GETs; ensure UI “recovering” ends when GET adopts, not when calc tick arrives | — |
| **Trim initial SSE frame** | Initial frame includes full data + liveState; optional “headers only” + lazy body | Protocol change |
| **Faster EventSource reconnect backoff** | Browser ES reconnect is opaque; app-level recreate with capped backoff on sticky errors | Avoid retry storms (memory: don’t network-retry auth/cancel) |
| **`X-Accel-Buffering: no` + proxy idle > heartbeat** | Prevents silent stall looking like “never connects” | Ops config |
| **Don’t block UI chrome on profiles/factory fetch** | Wake adoption chains profiles + factory; stream critical day-state first | Stale profile names briefly |

**Practical quick wins (likely highest ROI):**

1. End “recovering” as soon as **day-state adopt** succeeds; run profiles/factory in background.  
2. On wake, **GET with snapshot** first; only full body if mismatch.  
3. Ensure proxy doesn’t buffer SSE (connection appears hung).

---

## 5. Making reconnect **safer** (stop old overwriting new)

### 5.1 Hard rule (product)

> After any disconnect, a device may not apply a **full-document LWW push** until it has adopted a server baseline **and** its push is either (a) based on that baseline’s snapshot/revision, or (b) an operational intent with server-side conflict checks.

This is mostly the existing wake fence—**enforce it for all reconnect entry points** (online event, SSE error reopen, first mount, BFCache restore).

### 5.2 Prefer revision / snapshot over wall-clock

| Mechanism | Role |
|-----------|------|
| `baseSnapshotId` / partial contract | Already rejects stale base under lock |
| `canonicalRevision` | Treat as **server sequence**; client should send `baseRevision` on every PUT |
| Client stamps | Use only to merge **within** same base; if `baseRevision < server`, **rebase** (adopt server, re-apply local field diffs) instead of stamp-wins |

**Recommended server behavior for ordinary PUT:**

```text
if client.baseRevision < server.canonicalRevision:
  // Option A (strict): 409 + complete snapshot; client rebases
  // Option B (merge): protectRunValues as today, but stamp cannot beat
  //   server fields that changed after client's base (requires server
  //   remembering per-field revision — heavier)
```

Option A is simpler and matches optimistic concurrency practice. Partial already does the spirit of this for omitted sections; **extend to complete PUTs** that still carry a declared base.

### 5.3 Cap or rewrite client stamps on accept

On successful server write, server can:

- Persist `runValuesUpdatedAt[id] = serverTime` (or max(client, serverTime) with clamp)  
- Reject client stamps **> serverNow + skewAllowance** (e.g. 2–5 minutes)—mirrors packaging `manualOverrideUntil` clamp  

Stops “clock set to next year” devices from permanent dominance.

### 5.4 Narrow the LWW unit

Whole-run stamp is the damage multiplier. Near-term:

- Keep separate registers (packaging already separated; extend for sauce/app batch correction generations already partially present)  
- Long-term: field-level or section-level stamps for high-contention keys only  

### 5.5 Reconnect push policy

After successful wake adopt:

1. Compute local vs adopted **diff**  
2. If no meaningful local residue → **do not push**  
3. If residue → partial PUT with `baseSnapshotId` of **just-adopted** snapshot  
4. Never push the **pre-wake** payload (generation abort already aims here—audit all entry points)

### 5.6 UI honesty

When server rejects or merges away local fields (conflict log / partial fallback):

- Surface “Some offline changes were not applied; showing plant state”  
- Offer conflict stats already available rather than silent LWW  

---

## 6. Concrete implementation plan

### Phase R1 — Reliability fences (low risk)

1. Audit every path that calls `schedulePush` / `writeToday` during `connecting` or `waking`.  
2. On SSE error → reconnect: force **same** wake barrier as visibility (shared owner already partially there).  
3. On cancelled recovery: always `releaseCancelledForegroundRecovery` (discard queue).  
4. Instrument: `reconnect.t_baseline_ms`, `reconnect.push_suppressed`, `partial_fallback`, `stamp_skew_rejected`.

### Phase R2 — Faster baseline

1. Wake: GET snapshot short-circuit first.  
2. Split recovering UX: day-state ready vs secondary (profiles).  
3. Proxy SSE buffering off; confirm idle timeout.  

### Phase R3 — Causality fix (stops overwrite class)

1. Client includes `baseRevision` + `baseSnapshotId` on **all** PUTs.  
2. Server: if base mismatch → no stamp-win apply; return complete snapshot (`409` or existing partial-fallback style).  
3. Client rebase: adopt → re-apply local dirty fields → partial push.  
4. Server clamp: client stamp ≤ serverNow + 5m; normalize stored stamps to server time on write.

### Phase R4 — Contention narrowing

1. Expand independent registers for fields that multi-station edit (progress vs recipe setup).  
2. Prefer operational intents for lifecycle (already server-ledgered).  

---

## 7. Test matrix (must pass)

| Scenario | Expect |
|----------|--------|
| A edits online; B offline old state; B reconnects | Server retains A; B adopts then may partial-push only true local residue |
| B clock +1 hour offline edit; A newer real edit | Clamp / baseRevision prevents B clobber |
| Wake with dirty form | Barrier holds; after adopt, one partial push |
| SSE drop mid-day | GET baseline; no pre-drop payload retry |
| Two tabs same device | Signature skip; no ping-pong |
| Partial base race | `partialFallback` + complete body; no apply |
| Cancelled recovery | Queued write discarded |

Reuse: `sync.convergence.integration.test.ts`, e2e sync-convergence, foreground wake tests.

---

## 8. What not to do

- Raise Express 10mb / 512KB caps to “fix” reconnect (wrong lever)  
- Disable LWW entirely without revision protocol (diverging tablets)  
- Treat every SSE `initial: true` as atomic seed (wipes offline New Run)  
- Network-retry auth failures or cancelled generations (retry-storm memory)

---

## 9. Summary

| Goal | Approach |
|------|----------|
| **Faster connect** | Snapshot GET first; finish recovering on day-state adopt; fix proxy buffering; parallelize secondary fetches |
| **More reliable connect** | One wake owner for visibility **and** SSE error; discard cancelled queues; generation abort |
| **Stop old overwriting new** | Base revision/snapshot on every PUT; rebase instead of stamp-wins across bases; clamp future client stamps; keep adopt-before-publish |

The overwrite bug is not primarily “EventSource is slow”—it is **causality**: client wall-clock LWW winning across a disconnect. Speed work without Phase R3 will still occasionally corrupt the plant state after flaky networks.

---

## Related docs

- [sync-deep-dive-2026-09-19.md](sync-deep-dive-2026-09-19.md)  
- [server-research-deep-dive-2026-09-19.md](server-research-deep-dive-2026-09-19.md)  
- `.agents/memory/wake-sync-claim-fence.md`, `sync-retry-storms.md`, `partial-sync-contract.md`
