---
name: Local result comparability
description: Conservative interpretation of saved local checks across source and verification changes.
---

Treat saved local comparison as optional analysis, never a new readiness or certification authority. A source change may be compared, but changed verification inputs prevent regression/recovery attribution. An incomplete attempt prevents comparison of even its recorded PASS/FAIL rows.

**Why:** A superficially improved result can come from changed checks or an interrupted capture, not a repaired implementation. The owner explicitly required missing/incomplete evidence never to count as recovery. Conservative whole-attempt handling avoids suggesting interrupted runs establish a comparable result.

**How to apply:** Preserve exact identities, show both fingerprints for each input, expose missing or incompatible evidence, and never infer individual browser results from aggregate check labels.
