---
name: Build integration isolation
description: Isolate build environments, caches, external runtime assets and stale stages in temporary build workspaces.
---

Reuse installed third-party dependencies read-only, but keep bundler cache directories local to the disposable build workspace.

**Why:** Installed dependency directories can already contain writable Vite configuration caches. Linking every entry shares those caches with a running workspace, even when application source and output directories were copied correctly.

**How to apply:** Treat dependency links as an allowlisted resource, not a whole-directory clone. Rebind workspace-owned library packages to copied sources and exclude generated tool caches; build configuration loaders can write inside dependency directories before the application build begins.

Explicitly set the child build's `NODE_ENV` to `production` when a browser fixture must exercise production-only behavior. Do not change the parent process environment.

**Why:** Vite can resolve `import.meta.env.DEV` as true during `vite build` when the parent supplies a development/test `NODE_ENV`. An apparently production-built PWA fixture can therefore disable its own update checks and test the wrong application branch.

**How to apply:** Preserve unrelated child flags, use distinct fixture identities, and verify Vite's resolved DEV/PROD flags. A passing environment regression does not certify the browser handoff or permit relaxing active-work protection.

Keep an isolated copy of the installed package-manager state when reusing dependencies.

**Why:** pnpm 12 can implicitly install before running a package script when its installed-state metadata is absent. Merely linking resolved packages is not enough to make a fixture a run-only environment.

**How to apply:** Copy installed-state metadata as disposable regular files, rather than linking writable originals or omitting the records. Require the intended build failure, not a package-install failure, in negative integration cases.

For non-root container commands, do not let pnpm verify/reconcile a workspace install that was created as root during image build.

**Why:** pnpm's install metadata records the builder user's store path. Switching to the runtime user can make `pnpm run` try to replace the builder-owned virtual store, even though the frozen build already installed the command's dependencies.

**How to apply:** Keep the runtime workspace read-only and run the migration command with `--config.verify-deps-before-run=false` when its dependencies are installed with `pnpm install --frozen-lockfile` during the image build. Do not solve this by running the migration as root or broadly chowning the builder workspace.

When a production build consumes assets outside its ordinary source roots, allowlist every runtime asset in the sealed source fingerprint and ensure isolated builds copy those same files. Version the source policy when the input boundary changes. A leftover counterpart stage from an older policy must not fail a non-final build stage, but final sealing must still reject mismatched identities.

**Why:** Isolated build copies are assembled from the fingerprinted file list. An unlisted report can be absent from the isolated build and can alter runtime behavior without changing the recorded source identity. Policy bumps can also leave old stage metadata in the other artifact's output directory.

**How to apply:** Add exact external assets to required inputs and the fingerprint allowlist, include them in the isolated fixture, and test that changing each asset changes the identity. Treat an invalid old stage as incomplete during non-required sealing; require both current matching stages before writing final build identity.

Verify runtime approval bundles with the canonical loader against the assembled artifact directory, not just against repository files.

**Why:** Development can resolve reviewed evidence from the repository while production resolves it from the compiled directory. A source-only test can pass even when the publish build copies an obsolete manifest or omits its referenced evidence.

**How to apply:** Derive the copied bundle from the active reviewed manifest, validate its pinned files before and after copying, and test the packaged loader. Keep zero-database metadata assertions separate from the CLI's readiness probes, which legitimately check database health.