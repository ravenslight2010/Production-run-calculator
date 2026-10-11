---
name: Build integration isolation
description: Seal external runtime assets and isolate caches and stale build stages in temporary build workspaces.
---

Reuse installed third-party dependencies read-only, but keep bundler cache directories local to the disposable build workspace.

**Why:** Installed dependency directories can already contain writable Vite configuration caches. Linking every entry shares those caches with a running workspace, even when application source and output directories were copied correctly.

**How to apply:** Treat dependency links as an allowlisted resource, not a whole-directory clone. Rebind workspace-owned library packages to copied sources and exclude generated tool caches; build configuration loaders can write inside dependency directories before the application build begins.

Keep an isolated copy of the installed package-manager state when reusing dependencies.

**Why:** pnpm 12 can implicitly install before running a package script when its installed-state metadata is absent. Merely linking resolved packages is not enough to make a fixture a run-only environment.

**How to apply:** Copy installed-state metadata as disposable regular files, rather than linking writable originals or omitting the records. Require the intended build failure, not a package-install failure, in negative integration cases.

When a production build consumes assets outside its ordinary source roots, allowlist every runtime asset in the sealed source fingerprint and ensure isolated builds copy those same files. Version the source policy when the input boundary changes. A leftover counterpart stage from an older policy must not fail a non-final build stage, but final sealing must still reject mismatched identities.

**Why:** Isolated build copies are assembled from the fingerprinted file list. An unlisted report can be absent from the isolated build and can alter runtime behavior without changing the recorded source identity. Policy bumps can also leave old stage metadata in the other artifact's output directory.

**How to apply:** Add exact external assets to required inputs and the fingerprint allowlist, include them in the isolated fixture, and test that changing each asset changes the identity. Treat an invalid old stage as incomplete during non-required sealing; require both current matching stages before writing final build identity.