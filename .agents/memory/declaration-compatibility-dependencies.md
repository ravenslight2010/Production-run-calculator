---
name: Declaration compatibility dependencies
description: Why disposable declaration assignability checks separate direct import resolution from dependency library diagnostics.
---

Disposable declaration compatibility checks must mirror each workspace package's local dependency links. Verify every direct import resolves before compiling bidirectional assignments, then skip diagnostics inside dependency declaration libraries.

**Why:** pnpm does not expose all workspace dependencies at the repository root, and dependency packages such as Drizzle can contain unrelated optional-module and cross-dialect declaration errors. Requiring all dependency library diagnostics to pass blocks valid contract checks; skipping them without a direct-import preflight can silently turn unresolved public types into `any`.

**How to apply:** For compiler-migration declaration comparisons, reproduce package-local module resolution in each disposable tree, fail on unresolved imports from approved modules, and keep the actual mutual assignments in a non-declaration source file so both compilers still enforce them.