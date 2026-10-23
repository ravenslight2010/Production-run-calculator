---
name: Advisory Brix target policy
description: Owner-approved rules for manager-reviewed Brix targets and their relationship to weight QC.
---

Brix targets and tolerances remain separate from weight targets. Both require an explicit manager-reviewed value; do not infer a target from workbooks, inherit weight defaults, or apply an implicit ±0.5 °Bx tolerance. Missing or unreviewed configuration remains not evaluated. Brix outcomes are advisory and must not gate production or shipping.

**Why:** The owner approved a separate Brix workflow with no default tolerance; an assumed limit could create a false pass.

**How to apply:** Keep Brix target configuration, reading validation, and displayed units distinct from weight QC. Any future import, expiration, alert, or analytics work must preserve not-evaluated behavior and the non-blocking boundary.
