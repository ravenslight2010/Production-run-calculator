# Reconnect Reliability Deep Dive

**Date:** 2026-09-19
**Status:** Repository research and design recommendations; not an incident root-cause report
**Related:** [Sync deep dive](sync-deep-dive-2026-09-19.md), [sync improvements plan](sync-system-improvements-plan.md)

## 1. Scope

This document examines two separate goals:

1. Reduce time to a trusted baseline after focus, visibility, online, or SSE recovery.
2. Prevent a disconnected device from publishing stale state over newer plant state.

The code contains substantial reconnect fencing. Production traces or a deterministic reproduction are still required before attributing a reported overwrite to one mechanism.

## 2. Current protections

- The sync state machine defers pushes until an initial baseline is accepted.
- Foreground recovery is generation-fenced and follows **adopt before publish**.
- Cancelled recovery discards queued pre-wake writes.
- Auto-track claims wait for recovery acknowledgement.
- The push queue is single-flight and replaces queued state with the latest local snapshot.
- A signature check skips a payload already acknowledged.
- When a canonical snapshot exists, ordinary form pushes use the partial contract with `baseSnapshotId`; unchanged run values may be omitted.
- The server validates a partial base while holding the daily row lock. A stale, malformed, missing, or raced base is not applied and returns a complete authoritative fallback.
- Operational intents use a separate idempotent ledger and revision-aware contract.

Every SSE connection receives an initial complete frame. Client acceptance also checks completeness, date/reset boundaries, and canonical state; `initial: true` alone is not a first-ever seed instruction.

## 3. Remaining stale-overwrite risk

After reconstruction, ordinary run values still use per-run client-authored timestamps in `protectRunValues`. Partial-base validation prevents applying a sparse write to the wrong base, but complete writes remain possible before a canonical baseline and client stamps can still be coarse.

A plausible failure sequence is:

1. Device A writes newer plant state.
2. Device B reconnects with an older run blob carrying a later client clock value.
3. A complete or reconstructed merge compares whole-run timestamps.
4. B's run blob wins even though it did not observe A's change.

This is a design risk, not a confirmed production root cause without trace or reproduction evidence.

`canonicalRevision` is server-maintained, but its increment behavior is route-specific. Ordinary partial day-state PUTs carry `baseSnapshotId`; operational-intent requests carry `baseRevision`. Do not assume every day-state PUT currently has a revision precondition.

## 4. Faster trusted recovery

Recommended order:

1. Use the existing snapshot-aware `GET /api/sync/today` on wake.
2. End the blocking recovery state when authoritative day-state adoption succeeds.
3. Refresh profiles and factory configuration without extending the critical recovery barrier unless a verified dependency requires it.
4. Keep SSE open for subsequent live updates.
5. Verify deployed proxy buffering and idle timeout against the existing heartbeat before changing reconnect cadence.

The handler already emits heartbeats. The remaining deployment question is whether the actual proxy buffers or closes the stream.

## 5. Stronger causality

### Near term

- Audit every reconnect entry point so no pre-adopt payload survives a generation change.
- After wake adoption, compute meaningful local residue and send only a partial write based on the just-adopted snapshot.
- Do not retry authentication failures or cancelled generations.
- Surface a bounded message when local offline edits are rejected or merged away.

### Proposed protocol strengthening

- Extend explicit revision preconditions to ordinary complete writes.
- On an older declared base, return authoritative state and require client rebase instead of allowing a cross-base timestamp win.
- Consider server-side rejection of implausibly future client stamps.
- Narrow LWW units only for fields with measured multi-station contention.

Server-side normalization of run-value timestamps is proposed, not current behavior.

## 6. Safe observability

Useful bounded metrics:

```text
reconnect.baseline_ms
reconnect.push_suppressed
sync.partial_fallback
sync.future_stamp_rejected
```

Record timing, counts, modes, and bounded byte sizes only. Never retain day-state, recipe, request, or SSE payload content.

## 7. Verification matrix

| Scenario | Expected result |
|---|---|
| A edits online; B reconnects with old state | B adopts first; stale pre-wake payload is not published |
| B clock is far ahead | A future-stamp policy rejects or bounds the stamp |
| Wake with local dirty fields | Adopt first; only meaningful residue is rebased and sent |
| SSE drops mid-day | Recovery obtains a trusted baseline; no old generation retries |
| Partial base races | Complete authoritative fallback; sparse write is not applied |
| Recovery is cancelled | Queued pre-recovery write is discarded |

Reuse convergence, partial-fallback, foreground-wake, and browser peer tests. Retain results as test/release evidence rather than placing run output in `.agents/memory/`.

## 8. Decision

Treat reconnect speed and stale-overwrite prevention as related but distinct work:

- **Speed:** shorten the path to authoritative day-state adoption and verify proxy behavior.
- **Safety:** preserve adopt-before-publish, strengthen complete-write preconditions, and rebase local residue.

Do not describe client-clock causality as the production root cause until evidence establishes it.