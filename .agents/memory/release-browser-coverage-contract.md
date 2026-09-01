---
name: Browser coverage contract
description: The retained full-browser report has a case-count contract shared by the suite reporter, release verifier, and test fixtures.
---

The full-browser evidence contract must change in lockstep with the number of cases enumerated by the release suite. A suite can pass while the reporter refuses to retain its report if its expected-case constant is stale.

**Why:** A release run reached a complete browser pass but produced no current report because four newly enumerated explicit-skip cases left the historical expected count behind.

**How to apply:** When browser coverage is added or removed, update the reporter, release verifier, and their fixtures/documentation together, then run the full evidence-producing suite and standalone verifier.