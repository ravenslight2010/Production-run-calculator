---
name: Release gate dependencies
description: Release evidence must continue independent gates while recording failed prerequisites and their blocked dependents.
---

The release runner should model dependencies explicitly: independent security,
source-reconciliation, workflow, typecheck, and test domains continue when
another domain fails, while a dependent gate is recorded as `BLOCKED` with the
failed dependency named. A release decision remains fail-closed.

**Why:** Stopping at the first failed stage hides actionable failures and
creates an incomplete repair plan; running every later gate indiscriminately
can cross destructive or workflow safety boundaries.

**How to apply:** When adding a release gate, decide whether it is independent
or depends on a named gate, keep destructive database/browser limits unchanged,
and preserve blocker details in both checkpoint and retained report output.