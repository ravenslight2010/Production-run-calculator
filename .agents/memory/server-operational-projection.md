---
name: Server operational projection
description: Live timers and counters are transported beside, not inside, the persisted sync snapshot.
---

The server operational projection is a versioned read model derived from the canonical run snapshot. It may be included in GET, write responses, auto-track claim responses, and SSE frames, but it must not be persisted inside the sync document or included in its snapshot hash.

**Why:** Persisting a time-varying projection in the LWW document would make heartbeats look like operator edits, invalidate snapshot identities every few seconds, and allow stale timer frames to participate in data convergence.

**How to apply:** Keep the canonical revision, snapshot ID, reset epoch, and server capture time as transport metadata. Clients may animate between captures using the server clock offset, but automatic writes and final counters must continue to use the latest server projection/claim result.

## Clock domains during pending work

Pending lifecycle anchors must use the same estimated server-clock domain as
confirmed anchors. Keep local choice-window deadlines and automatic cadence
bookkeeping on the browser clock.

**Why:** Mixing local pending anchors with a server-offset display advances or
rewinds offline timer previews. Applying that offset to local deadlines instead
can immediately expire a pause choice or replay held time.

**How to apply:** Translate event anchors at capture, not the entire timer hook.
Retain immutable requested events and let accepted server receipts replace them.

## Command generation authority

Lifecycle commands must observe the adopted run generation, not a maximum stamp
overlaid from browser recovery or setup storage.

**Why:** A newer local-only stamp can survive recovery while canonical counters
are already visible. Using that stamp for End produces a valid server conflict,
even though the operator has adopted the accepted physical totals.

**How to apply:** Keep ordinary setup/recovery stamps separate from command
baselines. Preserve the server generation guard and review evidence; never
weaken that guard or silently retry a rejected event with a different identity.

## Shared display versus explicit calculation targets

Shared station read models must choose a run from canonical lifecycle facts.
Device selection is not canonical. Explicit per-run calculations must retain
their independent target, including historical and bounded drain targets.

**Why:** Replacing every calculation target with the active run would fix shared
displays but corrupt historical reports and drain tracking for another run.

**How to apply:** Keep shared lifecycle selection separate from explicit-target
calculation. Bind the projection and due schedule to the same run and lifecycle
generation; reject stale client projections before using any of their timers.