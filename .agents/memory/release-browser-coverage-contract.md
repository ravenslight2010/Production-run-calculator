---
name: Browser coverage contract
description: The retained full-browser report has a case-count contract shared by the suite reporter, release verifier, and test fixtures.
---

The full-browser evidence contract must change in lockstep with the number of cases enumerated by the release suite. A suite can pass while the reporter refuses to retain its report if its expected-case constant is stale.

**Why:** A release run reached a complete browser pass but produced no current report because four newly enumerated explicit-skip cases left the historical expected count behind.

**How to apply:** When browser coverage is added or removed, update the reporter, release verifier, and their fixtures/documentation together, then run the full evidence-producing suite and standalone verifier.

Focused browser matrices that protect a standard-release behavior but would
duplicate cases in the full suite should run as their own serialized standard
release gate and be explicitly ignored by the full-suite config.

**Why:** A package script alone is optional and does not protect releases, while
collecting the same fixture in the full suite silently expands its fixed case
and runtime budget.

**How to apply:** Give the focused lane a `browser *` release label so it shares
the stateful browser lock, add an inventory assertion that preserves the gate,
and exclude its spec from the full Playwright config.