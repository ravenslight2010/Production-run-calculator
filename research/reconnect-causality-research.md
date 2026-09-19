## Repository Findings

**Revision reviewed:** `b0f9d281ece0002fc0ad9543edb8dbdac84ceeb4`

### Existing protections

1. **Partial writes are causally fenced by snapshot identity.**
   - `upsertProtected` locks the reset row and daily row before validating a partial payload.
   - It reconstructs the candidate from the locked canonical row and validates `baseSnapshotId` against the locked snapshot.
   - Missing, malformed, stale, or raced bases return the complete authoritative snapshot with `partialFallback: true`; the sparse write is not applied.
   - Evidence: `artifacts/api-server/src/routes/sync.ts:1131-1189`.

2. **Complete writes do not currently carry an equivalent snapshot/revision precondition.**
   - Complete payloads proceed directly into `protectRunValues`.
   - `canonicalRevision` is returned and stored, but ordinary day-state writes do not compare an incoming revision or reject an older base.
   - Evidence: `artifacts/api-server/src/routes/sync.ts:1190-1217`; `docs/sync-deep-dive-2026-09-19.md:63-74`.

3. **Per-run values use client-authored timestamps for LWW.**
   - A run value is accepted only when its incoming `runValuesUpdatedAt[runId]` is strictly newer than the stored value.
   - This prevents an older or equal stamp from overwriting a newer value, but it does not prove that a newer stamp represents causally newer work.
   - A disconnected client can retain an old value and later submit it with a larger timestamp.
   - Evidence: `artifacts/api-server/src/lib/protectRunValues.ts:28-36, 532-557`; `docs/reconnect-reliability-deep-dive-2026-09-19.md:30-43`.

4. **Reconnect fencing substantially reduces stale replay.**
   - The browser waits for a trusted baseline before pushing.
   - Foreground recovery uses generation fencing, adopt-before-publish ordering, and discards queued work for cancelled generations.
   - The queue allows one in-flight write and replaces queued state with the newest queued snapshot.
   - Evidence: `artifacts/run-calculator/src/syncPushQueue.ts:1-35`; `artifacts/run-calculator/src/foregroundSyncWakeGuard.test.ts:519-582`; `docs/reconnect-reliability-deep-dive-2026-09-19.md:16-28`.

5. **The existing convergence suite proves important cases, but not future-clock complete-write causality.**
   - It exercises offline reconnect, stale payloads, blank protection, reset fencing, and convergence.
   - Its stale payload uses an old stamp and is therefore expected to lose.
   - There is no focused case in the reviewed suite where a stale complete payload carries a deliberately future `runValuesUpdatedAt`.
   - Evidence: `artifacts/api-server/src/routes/sync.convergence.integration.test.ts:289-359`.

### Deterministic stale-overwrite sequence that remains possible

A plausible sequence is:

1. Device A and Device B both read canonical run value `x` with stamp `100`.
2. Device A changes the value to `A`, submits stamp `200`, and the server accepts it.
3. Device B goes offline before observing A’s update. It still holds value `x`.
4. B’s local clock is ahead, or its queued mutation was assigned a future timestamp, so B submits `x` with stamp `300`.
5. If B submits a **complete** payload, there is no base snapshot precondition.
6. `protectRunValues` sees `300 > 200` and accepts B’s stale value.
7. A’s value is replaced even though B never observed it.

This is not a confirmed production incident. It is a protocol-level possibility demonstrated by the combination of complete-write acceptance and client-authored per-run stamps.

### Cases that should not produce this overwrite

- B submits a valid **partial** payload based on the pre-A snapshot: the server rejects it with complete `partialFallback`.
- B reconnects through the current foreground recovery path and the recovery succeeds before queued replay: B should adopt A’s canonical state before publishing.
- B’s stale payload has an older or equal run stamp: the stored value wins.
- B submits a blank/default value over a populated value: blank protection should preserve the populated value.
- B’s reset epoch is stale: the reset fence rejects the write before the document merge.
- B’s write is an operational intent rather than an ordinary day-state write: the separate revision-aware ledger applies stronger preconditions.

## External Evidence

1. **HTTP conditional requests are specifically intended to prevent lost updates.**
   - RFC 9110 describes entity tags as validators used in later conditional requests and identifies this mechanism as preventing the lost-update problem.
   - Quality: Tier 1, standards-track specification.
   - Source: [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
   - Saved evidence: `research/sources/reconnect-01-rfc9110.md`

2. **ETag/If-Match is a concrete optimistic-concurrency pattern.**
   - Azure’s documented flow is: read an ETag, send it in `If-Match`, accept only if the current ETag still matches, otherwise return `412 Precondition Failed` and reread.
   - This is directly analogous to requiring the client’s `baseSnapshotId` or `canonicalRevision` for complete writes.
   - Quality: Tier 1, official platform documentation.
   - Source: [Manage concurrency in Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage)
   - Saved evidence: `research/sources/reconnect-02-azure-concurrency.md`

3. **Physical time alone does not establish causality.**
   - Lamport’s work establishes that logical clocks can preserve happened-before ordering, while physical timestamps alone do not establish distributed event causality.
   - A timestamp that is numerically larger can still describe an event created from an older, unobserved state.
   - Quality: Tier 1, foundational academic paper.
   - Source: [Time, Clocks, and the Ordering of Events](https://www.cs.cornell.edu/courses/cs614/2002sp/Clocks.Lamport.1.pdf)
   - Saved evidence: `research/sources/reconnect-04-lamport-clocks.md`

4. **Hybrid logical clocks combine causality with physical-time proximity.**
   - HLCs preserve the happened-before relationship while remaining close to wall-clock time, making them more suitable than raw client timestamps when a protocol needs both ordering and approximate time.
   - HLCs would still need a server-side acceptance policy; adding an HLC field without making it part of an authenticated or server-validated precondition would not solve complete-write rebasing by itself.
   - Quality: Tier 1, USENIX technical publication.
   - Source: [Highly Auditable Distributed Systems](https://www.usenix.org/system/files/conference/hotcloud15/hotcloud15-demirbas.pdf)
   - Saved evidence: `research/sources/reconnect-03-hlc-usenix.md`

5. **A queue must account for all service instances, not just one process.**
   - The node-postgres maintainers recommend sizing `pool.max` across every service instance and being conservative in autoscaling environments.
   - This is relevant to the broader reconnect investigation because retries and reconnect bursts can multiply database demand across instances.
   - Quality: Tier 2, official maintainer documentation.
   - Source: [node-postgres pool sizing](https://node-postgres.com/guides/pool-sizing)
   - Saved evidence: `research/sources/reconnect-05-node-postgres-pool.md`

## Reproduction or Measurement Design

### Deterministic two-device protocol test

Use the existing disposable-database integration harness and add a focused scenario without production data.

#### Fixture

- One scope and one date.
- One run ID.
- Initial value:
  - `runValues.run-1.casesNeeded = 100`
  - `runValuesUpdatedAt.run-1 = 1_000`
- Both simulated devices adopt the same complete canonical response.
- Keep the reset epoch unchanged.

#### Matrix

| Case | Device A | Device B | Expected |
|---|---|---|---|
| A. Normal sequential edit | A writes value 110, stamp 2,000 | B writes value 120, stamp 3,000 after reading A | B wins |
| B. Stale complete, old stamp | A writes 110, stamp 2,000 | B submits old value 100, stamp 1,000 complete | A remains |
| C. Stale complete, future stamp | A writes 110, stamp 2,000 | B submits old value 100, stamp 3,000 complete | **Current implementation likely accepts B; this is the key regression case** |
| D. Stale partial, old snapshot | A writes 110 | B submits old value 100 with A-predecessor `baseSnapshotId` | Complete fallback; B’s sparse write not applied |
| E. Partial race | A and B submit partial writes from the same base concurrently | One may commit; the other must receive fallback and rebase |
| F. Wake adoption | B queues stale state while offline; A writes newer state; B reconnects | B must adopt A before queued replay |
| G. Cancelled wake | B starts recovery, queues write, recovery generation is cancelled | Queued pre-recovery write must not replay |
| H. Far-future stamp | A writes current state; B submits stale value with timestamp `serverNow + 1 day` | Current code has no ordinary run-value future-stamp rejection; expected result must be explicitly decided |
| I. Blank protection | A writes populated value; B submits blank with high stamp | Populated value remains |
| J. Reset epoch stale | A resets; B submits old epoch | Write rejected before merge |

#### Assertions

For every request record only:

- status/outcome;
- whether a complete or partial request was used;
- `partialFallback`;
- input and resulting snapshot hashes;
- input/result run-value stamp numbers;
- canonical revision;
- bounded duration.

Do not retain payload bodies.

### Client instrumentation design

Add temporary or permanent bounded counters:

```text
reconnect.baseline_ms
reconnect.push_suppressed
reconnect.queued_before_adoption
reconnect.queued_discarded_generation
sync.complete_write_without_base
sync.future_stamp_candidate
sync.partial_fallback
```

Suggested dimensions:

- scope-independent mode labels;
- outcome;
- bounded timestamp skew bucket:
  - `< 0`
  - `0–5s`
  - `5s–60s`
  - `> 60s`;
- no device identifiers unless hashed or explicitly approved;
- no run IDs, payloads, recipes, or raw timestamps if they could identify operators or records.

### Server policy experiment

Run the matrix under three policies:

1. **Current policy:** complete writes have no base precondition; client stamps are compared as-is.
2. **Complete snapshot precondition:** complete writes optionally carry `baseSnapshotId`; mismatch returns authoritative complete state without applying.
3. **Server-bounded stamp policy:** accept client stamps only within a bounded future window, otherwise clamp or reject with a typed outcome.

Measure:

- false rejections of legitimate offline edits;
- stale-write prevention;
- fallback/rebase frequency;
- recovery duration;
- queue growth.

## Claim Assessments

### Claim: “Foreground recovery prevents stale queued writes from replaying before adoption.”

- **Label:** verified
- **Confidence:** high
- **Evidence:** `foregroundSyncWakeGuard.test.ts:519-582` verifies the recovery fence, generation invalidation, cancellation discard, and failed-pull behavior.
- **Limitation:** This proves the client orchestration under test; it does not prove every browser lifecycle entry point or a compromised/legacy client obeys the protocol.

### Claim: “A valid partial write cannot apply against a stale canonical base.”

- **Label:** verified
- **Confidence:** high
- **Evidence:** Locked-row validation in `sync.ts:1160-1189`; documented partial-fallback integration coverage.
- **Limitation:** Applies only to payloads recognized as valid partial contracts. Complete writes remain outside this precondition.

### Claim: “Complete ordinary day-state writes are protected by canonical revision.”

- **Label:** contradicted
- **Confidence:** high
- **Evidence:** `upsertProtected` returns/retains the existing `canonicalRevision` but does not compare an incoming complete-write revision before merging; current documentation explicitly describes route-specific revision behavior.
- **What would change the result:** A route implementation and focused test showing complete writes reject an older declared revision.

### Claim: “Client-authored per-run timestamps establish causal ordering.”

- **Label:** unsupported
- **Confidence:** high
- **Evidence:** The server uses strict numeric comparison of `runValuesUpdatedAt`; Lamport’s work distinguishes event causality from physical time.
- **Limitation:** Timestamps may be a useful conflict heuristic, but they are not proof that the writer observed the state it overwrites.

### Claim: “A future-skewed stale complete write can overwrite newer plant state.”

- **Label:** partially verified
- **Confidence:** medium
- **Evidence:** The code path permits complete writes without a base precondition and accepts a strictly larger client stamp; the exact two-device sequence should be added to the disposable integration suite.
- **What would change the result:** A deterministic test showing the route rejects the future-stamped stale complete write, or a production trace proving the sequence occurred.

### Claim: “The reported production overwrite was caused by client clock skew.”

- **Label:** needs-human
- **Confidence:** high
- **Evidence gap:** No production trace, request metadata, or deterministic reproduction result establishes that cause.
- **Required next evidence:** Sanitized request outcome records containing mode, base presence, stamp-skew bucket, snapshot hashes, and server revision—not raw payloads.

### Claim: “HLC should be adopted immediately.”

- **Label:** unsupported
- **Confidence:** medium
- **Evidence:** HLC provides stronger causality properties than raw physical timestamps, but the repository’s primary missing protection is a complete-write base precondition. HLC would add protocol and migration complexity.
- **Scope limitation:** HLC may become useful if offline multi-writer causality remains necessary after explicit base fencing.

## Recommendations

1. **Add the future-stamped stale-complete regression test first.**
   - This converts the current design concern into a verified behavior or disproves it.
   - Keep it in the disposable convergence/integration suite.

2. **Extend complete writes with an optional base precondition.**
   - Prefer `baseSnapshotId` for consistency with the existing partial contract.
   - If the client lacks a trusted base, require a complete recovery before ordinary publish.
   - On mismatch, return complete authoritative data and do not merge the incoming complete body.

3. **Do not rely on client timestamps as the only causal safeguard.**
   - Preserve per-run timestamps for field-level LWW and compatibility.
   - Treat them as merge metadata, not authorization to overwrite an unseen canonical state.

4. **Add a bounded future-stamp policy after measuring legitimate skew.**
   - Start with diagnostics-only buckets.
   - Then choose an explicit policy:
     - reject implausibly future stamps;
     - clamp them to a server-derived bound; or
     - replace ordinary edit ordering with a server-issued causal token.
   - Avoid silently mutating values until the client can interpret the result.

5. **Rebase meaningful local residue after recovery.**
   - Adopt the canonical snapshot first.
   - Compute only fields changed locally since the adopted baseline.
   - Send those fields as a partial write using the newly adopted snapshot ID.

6. **Keep operational-intent causality separate.**
   - The existing revision-aware operational ledger is a stronger model for lifecycle actions.
   - Do not route lifecycle corrections back through unrestricted complete day-state writes.

7. **Use HLC only if the simpler precondition model is insufficient.**
   - First implement and measure complete-write base fencing.
   - Consider HLC if multiple offline writers still need causality-preserving ordering across long disconnected periods.

## Gaps

- No deterministic future-skew complete-write test was run in this assignment.
- No production request traces or sync metrics were inspected.
- Current conflict logs record hashes and field categories, but the reviewed evidence does not show whether they capture:
  - complete versus partial mode;
  - base snapshot presence;
  - client/server timestamp skew;
  - canonical revision at acceptance.
- The exact behavior of older deployed clients that do not send the current partial contract remains unknown.
- Browser-level recovery coverage is strong for the reviewed paths, but a full inventory of every code path that can issue a complete PUT still requires a route-to-client call-site audit.
- Any future-stamp threshold requires facility/device clock observations; a policy cannot be selected safely from repository code alone.

## Sources

1. **RFC 9110: HTTP Semantics** — standards-track HTTP specification; source quality Tier 1; current RFC.
   - URL: https://www.rfc-editor.org/rfc/rfc9110.html
   - Saved: `research/sources/reconnect-01-rfc9110.md`

2. **Manage concurrency in Azure Blob Storage** — official Microsoft platform documentation; source quality Tier 1; current platform guidance.
   - URL: https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage
   - Saved: `research/sources/reconnect-02-azure-concurrency.md`

3. **Highly Auditable Distributed Systems** — USENIX HotCloud technical publication on hybrid logical clocks; source quality Tier 1; academic/technical publication.
   - URL: https://www.usenix.org/system/files/conference/hotcloud15/hotcloud15-demirbas.pdf
   - Saved: `research/sources/reconnect-03-hlc-usenix.md`

4. **Time, Clocks, and the Ordering of Events in a Distributed System** — Leslie Lamport foundational paper; source quality Tier 1; academic source.
   - URL: https://www.cs.cornell.edu/courses/cs614/2002sp/Clocks.Lamport.1.pdf
   - Saved: `research/sources/reconnect-04-lamport-clocks.md`

5. **node-postgres pool sizing** — official node-postgres maintainer guide; source quality Tier 2; implementation guidance.
   - URL: https://node-postgres.com/guides/pool-sizing
   - Saved: `research/sources/reconnect-05-node-postgres-pool.md`