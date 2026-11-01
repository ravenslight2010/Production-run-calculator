---
name: Browser inventory preflight
description: Why complete browser runs need an explicit inventory preflight before runtime evidence collection.
---

Compare a read-only collection of exact browser-case identities with the reviewed
contract before starting an expensive complete runtime lane. Never resolve drift
by silently raising the count, filtering out cases, or changing retry/time limits.

**Why:** Playwright continued executing tests after a custom reporter rejected
the inventory in `onBegin`. Subsequent progress callbacks produced unknown-case
errors because inventory initialization had failed. A reporter exception alone
was not a reliable stop mechanism, and the resulting partial run was not valid
complete-suite evidence.

**How to apply:** Treat the first inventory rejection as the primary failure;
stop the isolated attempt with fixture cleanup and preserve its failed/interrupted
status. Compare added and missing identities separately, obtain any required
inventory approval, and distinguish discovery from executed browser results.
