---
name: Acknowledged master-data propagation
description: Why a successful local recipe save must explicitly trigger pending-run refresh instead of relying only on cache effects.
---

An acknowledged local master-data save must explicitly trigger its dependent
profile and pending-run refresh. Cache observation remains useful for bootstrap
and peer changes, but it is not a reliable local-save command boundary.

**Why:** Under a slow serial browser workload, the canonical cache publication
can become a component's first observed snapshot. A passive effect then
classifies the real edit as hydration and skips authoritative refresh, even
though the write succeeded.

**How to apply:** Carry the accepted canonical rows from the successful mutation
into an idempotent refresh command. Establish deduplication state synchronously
before awaiting persistence so the later cache effect cannot duplicate or
replace that command.