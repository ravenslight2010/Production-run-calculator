---
name: Server operational projection
description: Live timers and counters are transported beside, not inside, the persisted sync snapshot.
---

The server operational projection is a versioned read model derived from the canonical run snapshot. It may be included in GET, write responses, auto-track claim responses, and SSE frames, but it must not be persisted inside the sync document or included in its snapshot hash.

**Why:** Persisting a time-varying projection in the LWW document would make heartbeats look like operator edits, invalidate snapshot identities every few seconds, and allow stale timer frames to participate in data convergence.

**How to apply:** Keep the canonical revision, snapshot ID, reset epoch, and server capture time as transport metadata. Clients may animate between captures using the server clock offset, but automatic writes and final counters must continue to use the latest server projection/claim result.