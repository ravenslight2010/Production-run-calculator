---
name: Production publish workflow
description: Owner-confirmed platform for active production publishing and collecting production-only verification evidence.
---

The active production app is published through Replit; do not assume GitHub or Render owns the live deployment.

**Why:** The owner stated that publishing is done through Replit, and the workspace does not have the deployed app's database-owner connection. A development or partial-fixture query cannot establish production state.

**How to apply:** Use Replit deployment/runtime identity and a manager-authorized read-only capture in the production app for production-only evidence. Do not label local database results as production evidence or publish on the owner's behalf without explicit authorization.
