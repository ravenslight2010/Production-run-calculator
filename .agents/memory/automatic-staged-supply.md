---
name: Automatic staged supply
description: Durable accounting rules for automatic Sauce and Frontline staging.
---

Sauce and Frontline active-stage caps limit what is represented in the current pipeline, not how many barrels or batches may be produced during the run. Keep cumulative consumed/made progress as the synchronized claim and correction ledger, then derive the active stages and still-to-make quantity deterministically from the stable full-run requirement.

**Why:** Treating the three-Sauce or two-Frontline active limit as a lifetime cap stops replenishment on longer runs. A separate tab-local stage counter also diverges after reload, wake reconciliation, or peer adoption.

**How to apply:** Automatic claims continue one physical unit at a time until the full requirement is exhausted. Corrections rebase the cumulative ledger and timing anchor; all devices recompute the same bounded active pipeline from the adopted canonical values.