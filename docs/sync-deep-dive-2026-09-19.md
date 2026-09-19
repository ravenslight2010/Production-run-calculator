# Sync System Deep Dive

**Date:** 2026-09-19
**Status:** Current repository contract
**Related:** [Sync improvements plan](sync-system-improvements-plan.md), [reconnect reliability](reconnect-reliability-deep-dive-2026-09-19.md)

## 1. Corrected architecture summary

The server already supports **partial day-state writes**. Earlier roadmap language saying every write sends a full `dayState` is stale.

Canonical vocabulary:

- **Partial PUT:** current sparse-document contract.
- **JSON Patch:** optional future wire encoding.
- **Selective sync:** future read-scope or subdocument delivery.
- **Partial SSE:** current peer optimization when a safe delta is materially smaller.

## 2. Snapshot and partial contract

`syncSnapshotId` hashes canonical JSON with key-order-independent object handling.

| Mode | Contract |
|---|---|
| Complete | Full document; required for initial adoption and recovery |
| Partial | `completeness: "partial"`, `syncVersion: 1`, and a 64-hex `baseSnapshotId` |

For a partial write, the server:

1. Locks the reset epoch and daily document.
2. Reconstructs the canonical existing document.
3. Validates `baseSnapshotId` against that locked document.
4. Inherits omitted sections and overlays supplied sparse maps.
5. Runs server clamps, `protectRunValues`, `capMergedResult`, canonicalization, and reset-boundary handling.

If the base is stale, malformed, missing, or raced, the server does not apply or broadcast the sparse write. It returns complete authoritative data with `partialFallback: true` and `X-Sync-Response: partial-fallback`.

This is not RFC 6902 JSON Patch and not field-operation syntax.

## 3. Size limits

| Layer | Limit |
|---|---|
| Express parser | `10mb` |
| Sanitized aggregate sync document | 512 KB |
| Runs | 50 |
| Bounded list entries / strings | 500 / 200 |

The 10 MB parser setting prevents the historical parser-level 413. The enforced product bound is the 512 KB sanitized aggregate cap. Measure partial and complete wire sizes separately and also count parser-level rejections.

## 4. Peer SSE behavior

The broadcaster tracks each connected peer's last accepted data.

- Initial/recovery frames are complete.
- After a write, the server computes a peer delta from that baseline.
- It emits a partial frame only when the delta is safe and less than 80% of the complete frame size.
- Otherwise it sends a complete frame.
- The sender adopts the canonical HTTP response and does not receive its own SSE echo.
- A peer baseline advances only after its frame write succeeds.

The current system therefore has both partial PUT and conditional partial peer SSE. Selective per-run reads remain future work.

## 5. Merge and revision semantics

`protectRunValues` remains the behavioral core:

- per-run timestamp LWW;
- blank-over-populated protection;
- additive run-list union and tombstones;
- reset-boundary handling;
- history retention when omitted;
- independent packaging progress protection.

`canonicalRevision` is server-maintained, but increment behavior is route-specific. Operational claims increment it; ordinary day-state write behavior must be verified before using it as a universal per-write sequence. Snapshot identity is the established precondition for current partial PUTs.

## 6. Client ownership

- The synchronization state machine owns connection, push, wake, and reset ordering.
- The queue permits one in-flight PUT per tab and replaces queued state with newer local state.
- Foreground wake coalesces focus, visibility, and online triggers.
- Operational intents use a separate durable outbox and idempotent server ledger.

Day-state PUTs remain appropriate for bulk form/setup state. Lifecycle and correction actions should continue moving through operational intents where defined.

## 7. Existing evidence

- `artifacts/api-server/src/routes/sync.convergence.integration.test.ts`
- `artifacts/api-server/src/routes/sync.integration.test.ts`
- `artifacts/api-server/src/lib/protectRunValues.test.ts`
- browser sync-convergence and foreground-wake coverage
- `.agents/memory/partial-sync-contract.md`

Changing partial, merge, or peer-frame rules requires convergence plus large-day complete-versus-partial evidence.

## 8. Remaining work

1. Measure successful partial writes, partial fallbacks, complete writes, and partial peer-frame adoption.
2. Expand sparse coverage only for measured hot paths.
3. Add manager-visible per-device last-seen, queue depth, and lag.
4. Add client-facing conflict/reconciliation visibility; server logging and aggregate stats already exist.
5. Verify deployed proxy buffering and idle timeout against the heartbeat.
6. Consider JSON Patch only if the existing sparse contract cannot meet measured size goals.
7. Keep complete initial/recovery fallback.

## 9. Invariants

Any sync change must preserve:

1. client-local date keying;
2. reset epochs that fail closed;
3. reset-fence-before-document lock order;
4. tombstones and delete/undelete stamps;
5. separate run-meta, run-value, and packaging registers;
6. blank protection on client and server;
7. adopt-before-publish on wake;
8. completed-history retention;
9. no sparse apply on snapshot mismatch;
10. complete canonical recovery responses;
11. conflict logging outside the successful write transaction;
12. server-clock clamp for packaging manual override.

## 10. Decision

Phase A1 is no longer “invent delta sync.” It is:

1. measure current partial behavior;
2. expand it where evidence supports the complexity;
3. strengthen reconnect causality;
4. treat JSON Patch as an optional later encoding.