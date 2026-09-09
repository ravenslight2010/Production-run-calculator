---
name: Source-heal stale-client fence
description: Prevent disconnected or long-lived clients from restoring pre-repair recipe pools after an approved source-library heal.
---

An approved source-library repair must be paired with a server-enforced revision
precondition on full-pool recipe writes. Refresh nudges and client-side cache
invalidation improve convergence, but they are not an ownership fence: a
sleeping tab or resumed workflow can still submit an older complete pool after
the repair.

**Why:** A live repair was verified as exact and was later overwritten in
multiple full-pool write bursts from a long-lived production session. The
repair marker, aliases, profile links, pending runs, protected history, and
stub cleanup remained correct, while source-owned recipe fields drifted. The
write endpoints accepted those full snapshots without comparing them to the
server revision.

**How to apply:** Any future source-library heal must first make full-pool
writers send a server-issued revision and make the server reject stale or
missing preconditions without applying any row. A rejected client must adopt
the authoritative pool and must not retry its stale body. Only after that fence
is deployed should a fresh, manager-approved, fingerprinted one-time repair
restore affected production rows and be verified read-only against the live
database.