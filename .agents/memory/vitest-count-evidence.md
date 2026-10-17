---
name: Vitest count evidence
description: Privacy and completeness rules for adding Vitest totals to shared test reports.
---

Prefer a count-only Vitest reporter over the JSON reporter when adding test totals to shared reports. Temporary summaries may contain only run identity, revision identity, package identity, and bounded aggregate totals; validate the complete expected package set before publishing one lane total. Missing, inconsistent, interrupted, or stale summaries leave counts null. Never persist test names or output.

**Why:** The user selected a count-only reporter to avoid retaining raw case-level information while still making direct unit-test totals visible.

**How to apply:** Keep reporter activation opt-in through the shared test-results runner, tie summaries to the current run and source revision, discard temporary summaries after validation, and fail closed when any expected runner is absent. For recursive lanes, derive the expected package set from pnpm using the lane's own filter.

**Why:** Workspace globs and a separately maintained filesystem scan can drift, so the expected summary set must match the packages the test command actually selects.
