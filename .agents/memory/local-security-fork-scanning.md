---
name: Local security fork scanning
description: Distinguish scanner package-identity failures from evidence that locally maintained security fixes work.
---

Treat directory-version vulnerability findings as an identity limitation to
investigate, not proof that a reviewed local fork is vulnerable or safe.
Maintain regression tests for each advisory and verify real consumer resolution
before relying on a clean scan of first-party workspace source.

**Why:** The dependency scanner interpreted a local file path as picomatch's
version, reporting even advisories fixed in its upstream base. Moving the
already-repaired source into the workspace removed the opaque external package
identity, but that alone did not validate its protections.

**How to apply:** Check current advisory ranges and upstream availability.
Preserve explicit fork provenance and limitations, test malicious patterns in
timeout-bounded child processes, and keep a replacement plan for a verified
upstream release. Never rename a vulnerable package or suppress an advisory as
a substitute for repairing its source.

Traverse installed dependencies from active project importers when checking
resolution, rather than testing every directory in pnpm's virtual store.

**Why:** pnpm retains unreachable old package versions; scanning all those
directories falsely attributed an unused dependency to the active application.
