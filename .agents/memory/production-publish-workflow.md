---
name: Production publish workflow
description: Owner-confirmed platform for active production publishing and collecting production-only verification evidence.
---

The active production app is published through Replit; do not assume GitHub or Render owns the live deployment.

**Why:** The owner stated that publishing is done through Replit, and the workspace does not have the deployed app's database-owner connection. A development or partial-fixture query cannot establish production state.

**How to apply:** Use Replit deployment/runtime identity and a manager-authorized read-only capture in the production app for production-only evidence. Do not label local database results as production evidence or publish on the owner's behalf without explicit authorization.

A Replit build record marked failed can still correspond to the exact build currently serving. Compare the official deployment/build IDs with `/api/build-info`, then confirm `/api` readiness before recommending another publish. If identity matches and the app is ready, report the platform-status mismatch instead of treating it as a code failure.

**Why:** A recent Autoscale attempt was marked failed after service creation, while the same platform build ID and app source identity were live and healthy.

**How to apply:** After an owner reports a publish result, check deployment metadata and the official live endpoints directly. Never ask the owner to relay IDs or republish before this check.
