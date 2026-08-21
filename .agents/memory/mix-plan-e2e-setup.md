---
name: Mix-plan E2E setup
description: Environment behavior affecting browser tests that seed live runs before opening the Mix Plan.
---

LocalStorage-seeded live runs may be replaced during app startup synchronization before the Mix Plan tab renders. In the affected environment, the existing single-run Pull For Prep test fails at the first plan-card wait, before reaching its quantity assertion.

**Why:** This distinguishes a setup/sync harness failure from a regression in the live second-run recalculation path.

**How to apply:** When validating Mix Plan E2E changes, run a neighboring single-run Pull For Prep test first and report setup failure separately if it cannot render its initial plan.