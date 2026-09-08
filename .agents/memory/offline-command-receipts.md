---
name: Offline command receipts
description: Durable client rules for operational command delivery and canonical response adoption.
---

Real operational command responses must be awaited through canonical adoption before the outbox terminalizes the command. The sending record remains replayable when adoption or terminal storage fails.

**Why:** A local optimistic projection is not proof of server persistence, and older/idempotent duplicate envelopes can legitimately contain receipt metadata without another canonical data payload.

**How to apply:** Treat a response with canonical data as an adoption barrier for snapshot writes, timers, counters, and lifecycle actions. A data-less accepted duplicate may safely terminalize only after recording its cursor/revision/server-time/snapshot metadata; never infer persistence from local React state alone.