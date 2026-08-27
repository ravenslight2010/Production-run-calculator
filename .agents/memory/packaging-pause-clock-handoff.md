---
name: Packaging pause clock handoff
description: How automatic packaging progress crosses from a continued-tunnel pause back to the normal run clock.
---

During a pause where the tunnel continues, packaging progress is calculated from elapsed pause time. On Resume, that clock must reconcile its final positive increment exactly once and then re-base to normal net production elapsed time.

**Why:** Normal run elapsed time intentionally excludes the pause. Comparing it directly with the pause-relative packaging baseline makes subsequent normal increments appear negative, which stalls packaging until normal time eventually catches up.

**How to apply:** Preserve the continued-tunnel policy as the condition for pause-time packaging. Retain the last active pause-clock reading plus wall-clock endpoint, honor suppression/manual register rejection, and always switch the expected-case baseline to the normal clock after the one-time reconciliation. Do not advance dough counters during this phase.