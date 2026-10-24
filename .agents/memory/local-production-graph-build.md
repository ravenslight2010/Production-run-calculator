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

## Stale development-stage metadata after a source-policy change

A configuration-loading precheck can fail before TypeScript runs because an
ignored intermediate from a previous development build uses the old source
identity policy. Development-mode environment settings alone do not override
the intermediate record read by Vite configuration.

**Why:** A main-project sync changed the source policy while a completed local
browser build's stage-start record remained. The configured typecheck rejected
that obsolete record even though the report code and generated types passed.

**How to apply:** Verify the intermediate is ignored and explicitly has
development mode, then archive only that stale intermediate and rerun the
configuration check. Preserve publish identity records and validation guards.
Do not prepare a publish or weaken source-policy validation to repair local
metadata.

An obsolete web-stage intermediate can also retain `mode: publish` from an old
build. Do not confuse it with the actual prepared-source or expected-source
records. When no build is active, preserve the invalid intermediate outside its
active filename rather than rewriting its policy or regenerating publish identity.

**Why:** A configuration precheck read an old-policy stage intermediate left by
a prior build, independent of the currently prepared source. Archiving only that
ignored intermediate removed the local obstruction without preparing a release.

**How to apply:** Confirm the current validator policy, ignored status, record
kind/path and lack of an active build first. Keep the original bytes recoverable;
do not edit source/expected records or relax validation.
