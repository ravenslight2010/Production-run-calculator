---
name: Mix-plan E2E setup
description: Environment behavior affecting browser tests that seed live runs before opening the Mix Plan.
---

LocalStorage-seeded live runs may be replaced during app startup synchronization before the Mix Plan tab renders. Seed named runs before authenticated app boot, persist their run-value edit timestamp, and wait for server persistence before reload-based assertions. Browser runs also require the repository's explicit disposable/approved E2E database mode and a system Chromium path when the bundled browser is absent.

**Why:** This distinguishes a setup/sync harness failure from a regression in the live second-run recalculation path.

**How to apply:** When validating Mix Plan E2E changes, run a neighboring single-run Pull For Prep test first and report setup failure separately if it cannot render its initial plan.