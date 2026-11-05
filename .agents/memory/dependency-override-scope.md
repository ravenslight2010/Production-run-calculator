---
name: Security override scope
description: Choose the narrowest pnpm override that patches a vulnerable transitive dependency without breaking unrelated consumers.
---

For transitive advisories, prefer a parent-scoped override when only one plugin or package needs a newer major. Use a workspace-wide override for a patched minor/patch only when it remains within consumers' supported compatibility ranges. Validate the affected parent with its build and tests, then rerun frozen installation and the full audit.

**Why:** A global major replacement can alter unrelated dependency behavior, while leaving a vulnerable pinned subdependency prevents a clean workspace audit. Narrow scope limits compatibility risk without hiding the advisory.

**How to apply:** Inspect the advisory's patched version and each dependency path first. If a parent has no released fix, scope the override to that parent, confirm its API usage still works, and preserve the override only when the consuming build/tests pass.

When consumers require different major versions, do not use one global override to force them onto the advisory's fixed major. Prefer an upstream parent that releases the fixed version, then allow each consumer to resolve within its declared range.

**Why:** jsdom 30 requires Undici 8, while an older Scalar package pinned Undici 7 exactly. A workspace-wide Undici 7 override silently crossed that compatibility boundary and kept jsdom on an unsupported major.

**How to apply:** Compare every installed consumer's declared range with the resolved version before retaining or changing a global override; use the parent package's fixed release where available.

For pnpm v9 lockfiles, ordinary dependency ranges are usually absent from the lockfile; resolved snapshot edges alone cannot establish compatibility. Join those edges to installed consumer manifests, and use lockfile peer declarations and importer specifiers where available. Any approved incompatibility exception must match the exact override, consumer version, resolved version, declared range, and dependency kind, and stay visible in the check output.

**Why:** A lockfile-only comparison would miss regular dependency constraints, while a broad override-level exception could silently hide new consumers or version changes.

**How to apply:** Fail when a consumer leaves an approved exact exception tuple. Keep normal mismatches blocking; never exempt an entire package or parent chain.
