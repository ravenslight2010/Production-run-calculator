---
name: Mix plan snapshot freshness
description: Server-authority Mix Plan snapshots must not resurrect locally ended live runs after a reload.
---

When a local live run has an `endedAt` marker, prefer the local Mix Plan membership for that render over a server snapshot that may still be awaiting day-state acknowledgement.

**Why:** A cold reload can fetch the server snapshot before the stop write is acknowledged; treating that snapshot as authoritative recreates a Mix Plan card for a run the operator already ended.

**How to apply:** Preserve the online server snapshot for normal cross-device calculations, but fence it with the freshest local ended-run membership and keep the offline/local plan path available.