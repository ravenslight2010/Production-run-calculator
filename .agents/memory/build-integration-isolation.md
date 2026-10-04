---
name: Build integration isolation
description: Avoid sharing writable bundler caches when reusing installed third-party dependencies in temporary build workspaces.
---

Reuse installed third-party dependencies read-only, but keep bundler cache directories local to the disposable build workspace.

**Why:** Installed dependency directories can already contain writable Vite configuration caches. Linking every entry shares those caches with a running workspace, even when application source and output directories were copied correctly.

**How to apply:** Treat dependency links as an allowlisted resource, not a whole-directory clone. Rebind workspace-owned library packages to copied sources and exclude generated tool caches; build configuration loaders can write inside dependency directories before the application build begins.

Keep an isolated copy of the installed package-manager state when reusing dependencies.

**Why:** pnpm 12 can implicitly install before running a package script when its installed-state metadata is absent. Merely linking resolved packages is not enough to make a fixture a run-only environment.

**How to apply:** Copy installed-state metadata as disposable regular files, rather than linking writable originals or omitting the records. Require the intended build failure, not a package-install failure, in negative integration cases.