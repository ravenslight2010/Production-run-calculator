---
name: Production evidence revision binding
description: How to handle production release evidence when the deployed build revision is not exposed by runtime reporting.
---

Production reconciliation evidence must use the exact revision from the controlled release/deployment record. A live operational report that returns `unknown` is not sufficient proof of which build served the production database.

**Why:** A read-only production verifier can prove the heal marker, source report hash, repair boundary, and live row state, but assigning the current repository HEAD as the deployed revision would falsely claim release identity.

**How to apply:** Keep the live verification diagnostic separate from retained/promoted evidence until deployment metadata supplies the exact revision. Treat source-owned pool drift as a real verification failure even when marker, alias, profile, run-history, and stub checks pass.