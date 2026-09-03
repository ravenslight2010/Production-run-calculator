---
name: Data Health undo coverage
description: The boundary between Data Health profile repairs and future-run snapshot undo
---

Data Health apply can report refreshed future run snapshots while the persisted repair batch records only contain profile repairs. In that state, guarded undo can restore an unchanged profile and skip a changed profile, but it cannot restore the future run values because no per-run before/after records exist.

**Why:** Browser verification exposed that the apply summary and undo record shape can describe different scopes of work; asserting future-run undo without checking the batch record produces a misleading test failure.

**How to apply:** When extending Data Health undo coverage, inspect the stored batch records and require explicit per-run snapshots before asserting that eligible future runs are restored. Treat adding those records and restoration as a separate product task if absent.