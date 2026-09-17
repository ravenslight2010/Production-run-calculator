---
name: Release finalization retry safety
description: Release checkpoints can contain all passing gates while final evidence promotion has already happened.
---

Release finalization must be retry-safe after any evidence promotion or artifact write. A checkpoint with all gates passed may still need to regenerate or recognize promoted evidence before writing the final report; report-key evidence must also carry the exact current revision.

**Why:** A final report failure after evidence promotion left a successful checkpoint but no pending source-evidence file, so a plain resume could not finish without manual artifact restoration.

**How to apply:** Treat evidence promotion and final report writing as resumable stages, or make promotion idempotent by accepting the already-promoted, revision-validated artifact.