---
name: Release-check shard budget
description: API release shards are serialized and the capability-matrix shard can exceed the default four-minute budget.
---

The release checker’s API shard timeout must reflect serialized Vitest runtime, not the usual individual-test runtime; a healthy capability suite can take several minutes. Keep that suite isolated from general integration shards.

**Why:** A release run can report an infrastructure timeout even when the complete shard passes when isolated, creating a false NO-GO.

**How to apply:** When API integration coverage or its fixture set grows, compare the slowest serialized shard duration with the checker budget and retain a warning margin. Test route guards and role-to-capability resolution orthogonally instead of multiplying them into a route-by-role matrix with repeated database resets. The Replit shell runner may cap one foreground command at five minutes, so validate long release runs by executing the exact bounded shards individually when needed.

Detached, best-effort diagnostics must be tested as bounded telemetry, not lossless delivery under a deliberately stalled shared lock. After releasing a test lock, allow lock-bounded background transactions to settle before resetting shared tables.

**Why:** Requiring every detached diagnostic write to survive a lock timeout contradicts the availability contract, while moving to the next test too early lets unfinished transactions corrupt isolation.

**How to apply:** Keep strict assertions on request availability and local alerts; require shared diagnostics to recover with a bounded subset, then drain the bounded background work before teardown or the next test.

Read-only release preflights that share a database with concurrent prerequisite
gates should use a small bounded acquisition retry, while still failing closed
after the retry budget is exhausted. Their retained evidence must also bind to
the release revision so a transiently blocked or stale result cannot certify a
later run.

**Why:** Concurrent release prerequisites can briefly exhaust database checkout
capacity even when the target is healthy; accepting an exhausted audit would
weaken the rotation safety boundary, while retaining an unbound pass could
carry old key evidence into a new release.

**How to apply:** Retry only bounded read-only acquisition failures, preserve a
hard blocked result for missing/malformed/truncated key evidence, and validate
the retained preflight artifact against the exact release revision.