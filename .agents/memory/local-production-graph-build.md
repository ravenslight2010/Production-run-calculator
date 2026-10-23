---
name: Local production graph builds
description: Build production assets for local bundle analysis without changing the staged publish identity.
---

When a build is only for local bundle or dependency-graph analysis, run the artifact's normal production build with `BUILD_IDENTITY_MODE=development`. Do not refresh the staged publish source identity just to make a diagnostic build pass.

**Why:** Publish-mode builds compare the current source with the staged publish fingerprint, which can be stale during ordinary development. Development identity mode allows Vite to emit production assets without preparing or publishing a release.

**How to apply:** Use this mode only for local graph measurement. For release readiness or publishing, follow the normal release workflow and its validation gates.

Development identity mode still fingerprints every required source input. If retained source-library audit files are absent after syncing branches, the local app build fails closed; development mode does not bypass them.

**Why:** A post-sync workspace was missing two ignored source-evidence files that the build policy still requires, so a diagnostic browser build could not start even though the code typechecked.

**How to apply:** Restore only exact, verified local inputs from a preserved baseline when available. Do not fabricate placeholders or run `prepare:publish` just to unblock a local test; if the source cannot be verified, report the browser build as blocked.
