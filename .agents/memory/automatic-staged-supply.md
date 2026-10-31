---
name: Automatic staged supply
description: Durable accounting rules for automatic Sauce and Frontline staging.
---

Sauce and Frontline active-stage caps limit the current pipeline, not lifetime production. The owner explicitly requires Frontline's ticker to mean current physical on-line supply in batches, not cumulative made/consumed progress. Manual loads change supply, never consumption. Keep Sauce's separate policy unchanged.

**Why:** Treating the three-Sauce or two-Frontline active limit as a lifetime cap stops replenishment on longer runs. A separate tab-local stage counter also diverges after reload, wake reconciliation, or peer adoption.

**How to apply:** Frontline remaining demand subtracts consumption and current supply once each from stable full-run demand, preserving final fractions and the existing buffer. Rebase both supply-writing channels after a correction, without replaying held time. Historical cumulative consumption may establish a compatibility baseline only with a known batch weight; never turn it into stock or derive batch quantities from an unknown weight. Once the dedicated consumption ledger exists, it takes precedence over historical observations.