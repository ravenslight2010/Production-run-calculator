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

When a historical source-only copy cannot collect without its package metadata,
imports or build manifests, an identity reconstruction is acceptable only if it
reproduces the original frozen digest exactly. Preserve that original-set fence
alongside any newly approved inventory.

**Why:** Source-only historical discovery can fail before collection, while a
case already present in that source can still be absent from its recorded guard.
A matching count or a source diff alone does not prove preservation.

**How to apply:** Label failed setup attempts honestly; compare the reconstructed
sorted identity set to the prior digest, review every addition, and report
discovery separately from real browser execution. Do not treat reconstruction
as a historical runtime pass.
