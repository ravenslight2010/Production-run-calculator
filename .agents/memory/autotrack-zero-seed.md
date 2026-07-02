---
name: Auto-track zero-counter seed
description: Dough tray/batch counters auto-seed from the Suggest formula when the operator never enters them
---

**Rule:** Auto-track dough counters (trays on line / batches ready) only DECREMENT — if the crew never types a starting count they sit at 0 the whole run. Each counter gets a ONE-SHOT per-run seed at its first eligible tick (not suppressed, dough feed not complete): if still 0, seed with the same value the "Suggest" button computes; if the operator entered a value, no seed and the first tick decrements exactly as before (guard with a seededThisTick flag, not an else-branch, or manual runs lose one tick).

**Why:** Floor crews in practice never enter staged dough (DB showed 0 on every run over multiple days) while skids/cases counted fine — the "auto tracker stays at 0" report.

**How to apply:** Seed refs live next to the remainder-carry refs and MUST reset in the same reset path (web resetBookkeeping / mobile run-change reset effect). The suggestion formula is `suggestedDoughStaging(traysNeeded, batchesNeeded)` — shared export on web (useAutoTrack, also used by the Suggest UI), verbatim copy in mobile RunContext; keep them identical. Mid-run remount with a legitimately-0 counter re-seeds from the CURRENT deficit — accepted, self-consistent. Web+mobile parity mandatory.
