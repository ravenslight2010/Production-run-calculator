---
name: Declaration compatibility dependencies
description: Why disposable declaration assignability checks separate direct import resolution from dependency library diagnostics.
---

Disposable declaration compatibility checks must mirror each workspace package's local dependency links. Verify every direct import resolves before compiling bidirectional assignments, then skip diagnostics inside dependency declaration libraries.

**Why:** pnpm does not expose all workspace dependencies at the repository root, and dependency packages such as Drizzle can contain unrelated optional-module and cross-dialect declaration errors. Requiring all dependency library diagnostics to pass blocks valid contract checks; skipping them without a direct-import preflight can silently turn unresolved public types into `any`.

**How to apply:** For compiler-migration declaration comparisons, reproduce package-local module resolution in each disposable tree, fail on unresolved imports from approved modules, and keep the actual mutual assignments in a non-declaration source file so both compilers still enforce them.

Disposable TypeScript compiler probes that inherit a package's `types` or path settings should keep their fixture/config under that package, or explicitly reproduce its module/type roots. A temporary project outside the package can fail before reaching the intended diagnostic because package-local type definitions are no longer in resolution scope.

**Why:** A negative compiler test is only useful if its fixture reaches the intended source diagnostic rather than failing on a missing ambient type package.

**How to apply:** Keep isolated route/compiler fixtures outside the production source include but within the consuming package directory; override `rootDir` and `include` to restrict the probe to the fixture.

Workspace packages with TypeScript project references can also resolve stale ignored declaration output even when their current source barrel exports the expected API.

**Why:** A successful source search is not enough to diagnose a missing workspace export if the consuming project reads older built declarations.

**How to apply:** When a type check reports a missing public export, confirm the consumer's resolved package and declaration output, then rebuild that specific reference package before changing API source or contracts.