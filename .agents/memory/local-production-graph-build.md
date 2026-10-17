---
name: Local production graph builds
description: Build production assets for local bundle analysis without changing the staged publish identity.
---

When a build is only for local bundle or dependency-graph analysis, run the artifact's normal production build with `BUILD_IDENTITY_MODE=development`. Do not refresh the staged publish source identity just to make a diagnostic build pass.

**Why:** Publish-mode builds compare the current source with the staged publish fingerprint, which can be stale during ordinary development. Development identity mode allows Vite to emit production assets without preparing or publishing a release.

**How to apply:** Use this mode only for local graph measurement. For release readiness or publishing, follow the normal release workflow and its validation gates.
