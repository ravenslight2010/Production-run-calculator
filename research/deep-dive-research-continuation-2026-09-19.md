# Deep-Dive Research Continuation

**Date:** 2026-09-19  
**Branch reviewed:** `Replit` at `191fca40`  
**Status:** Integrated with corrections after comparison against the repository research set  
**Related:** [Operations deep dive](sync-reliability-operations-deep-dive-2026-09-19.md), [reconnect causality research](reconnect-causality-research.md), [additional domain synthesis](additional-domain-research-synthesis-2026-09-19.md), [unified plan](../docs/sync-reliability-unified-plan-2026-09-19.md)

This note integrates the uploaded continuation into the project research. It preserves the additional `canonicalRevision` analysis while correcting two statements that were broader than the available evidence.

## 1. Verified additions

| Finding | Assessment | Consequence |
|---|---|---|
| Ordinary day-state PUT does not increment `canonicalRevision` | Verified in the reviewed implementation | Revision cannot be used as a universal ordinary-write precondition without changing server write semantics |
| Operational-intent paths increment `canonicalRevision` | Verified in the reviewed implementation | Operational commands and ordinary day-state writes currently use different causality tracks |
| Partial PUTs validate `baseSnapshotId` under the reset and daily-row locks | Verified | A stale or raced partial base returns complete authoritative fallback without applying the sparse body |
| Complete PUTs lack the partial contract's base precondition | Verified | A stale complete body can reach per-run LWW comparison |
| Per-run LWW trusts client-authored wall-clock stamps | Verified | A numerically larger stamp is not proof that the writer observed an intervening edit |
| The client normally sends partial after adopting a canonical snapshot | Verified | First connection and recovery without a trusted snapshot remain the main complete-write cases |
| The client has an empty-form handoff guard | Verified as a client protection | It reduces one wipe class but does not provide a server-enforced complete-write precondition |

### Causality tracks

```text
ordinary day-state PUT
  -> protected data merge
  -> canonicalRevision retained

operational intent
  -> intent ledger + protected merge
  -> canonicalRevision incremented
```

Adding `baseRevision` to the wire contract alone would therefore be insufficient. If revision becomes the ordinary-write precondition, every successful ordinary day-state write must advance it atomically.

## 2. Corrections applied during integration

### 2.1 Stale partial writes

The uploaded note said an offline client's complete **or partial** write with a larger stamp could overwrite newer state. That needs a strict distinction:

- A partial write with a stale `baseSnapshotId` cannot apply. Under-lock validation returns `partialFallback` and leaves canonical data unchanged.
- A partial body can contain an old field value and still be accepted only when its declared canonical base matches the locked current document. In that case the issue is stale field content after a matching/rebased base, not a stale-base bypass.
- The directly established protocol gap is an unfenced complete write reaching client-stamp LWW.

The focused regression should therefore begin with the complete-write case. Partial mismatch remains a control case that must continue to fall back without applying.

### 2.2 Deployment target

The uploaded note listed the actual production deployment target as an open question. Sanitized deployment metadata already established an active public Replit Autoscale deployment.

The unresolved deployment properties are:

- active and maximum serving-instance counts;
- affinity or request routing behavior;
- proxy buffering and stream lifetime;
- reconnect timing;
- cross-instance SSE fanout;
- database capacity and production pool overrides.

Official Replit documentation confirms Autoscale scale-out and scale-to-zero, but does not explicitly guarantee or prohibit SSE, sticky sessions, buffering, or stream duration.

## 3. Complete-write protocol risk

The verified sequence is:

1. The canonical row contains run value `V1` with stamp `1000`.
2. Another device advances canonical state.
3. A disconnected client submits an older run value `V0` in a complete body with a larger client stamp, such as `5000`.
4. The complete path does not validate a declared snapshot or revision base.
5. Per-run LWW can accept `V0` because `5000` is numerically larger.

This is a protocol possibility. It is not proof that client clock skew caused a historical production incident.

## 4. Protocol options

| Option | Role | Decision |
|---|---|---|
| Complete-write `baseSnapshotId` | Reuse the existing canonical hash precondition | Preferred first server fence |
| `baseRevision` plus revision increment on every successful day write | Cheap monotonic precondition spanning ordinary writes | Design together; do not add `baseRevision` while day PUT remains revision-neutral |
| Future-stamp detection or clamp | Defense against implausible clocks | Measure first; cannot replace base fencing |
| Rebase-only wake behavior | Reduce complete publishing after reconnect | Preserve and strengthen, but do not rely on client compliance for server correctness |
| HLC or Lamport ordering | Stronger causal metadata | Defer until base fencing and measurements show a remaining need |

## 5. Highest-leverage disposable proof

Add a fixture-only API integration case:

1. Seed run `R` with `V1`, stamp `1000`.
2. Submit a stale complete body with `V0`, stamp `5000`.
3. Record the current behavior without describing it as incident proof.
4. After the protocol fix, require canonical `V1` to remain and return authoritative complete state with `wrote=false`.

Control cases:

- partial with mismatched `baseSnapshotId` returns `partialFallback` and does not write;
- matching-base partial still converges;
- reset-epoch mismatch fails closed;
- blank-over-populated protection remains intact;
- wake cancellation discards pre-adopt queued work.

## 6. Privacy-safe evidence

Recommended counters and histograms:

```text
reconnect.baseline_ms
reconnect.push_suppressed
reconnect.queued_discarded_generation
sync.complete_write_without_base
sync.partial_fallback
sync.future_stamp_candidate
sync.put.mode
sync.put.bytes
sync.sse.frame_bytes
```

Use bounded outcomes, sizes, timings, and run-count buckets only. Do not retain payloads, run IDs, recipes, users, facilities, dates, or arbitrary error text.

## 7. Definition of done for the overwrite class

1. A deterministic stale, future-stamped complete write cannot replace newer canonical run values.
2. Complete ordinary writes declare a validated snapshot or revision base.
3. Base mismatch returns authoritative complete state with `wrote=false`.
4. If `canonicalRevision` becomes the ordinary-write token, every successful day-state write advances it atomically.
5. Wake recovery adopts canonical state before rebasing and publishing meaningful local residue.
6. Staging evidence reports complete-without-base, partial-fallback, and future-stamp-candidate rates without retaining operational content.

## 8. Remaining evidence gaps

- Production complete-versus-partial PUT distribution.
- Any intentional client path that complete-pushes after a snapshot exists.
- Authenticated published SSE timing and cross-instance fanout.
- Database capacity, reserves, maximum serving instances, pool override, and transaction-duration distribution.
- Revision-bound evidence for a historical overwrite.
- Owner policy on whether AI-assisted workflows are a hard global readiness dependency.

The next work should prioritize disposable tests and bounded counters over additional narrative analysis.