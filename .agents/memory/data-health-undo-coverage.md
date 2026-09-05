---
name: Data Health undo coverage
description: The boundary between Data Health profile repairs and future-run snapshot undo
---

Data Health repair batches have two supported snapshot formats: legacy records nest future-run snapshots under the profile record, while current records store each run independently. Undo must guard each record independently so a profile restore does not gate eligible runs.

**Why:** The format changed to independent run records so a changed profile cannot prevent safe future-run restoration, but historical batches still carry nested snapshots and must remain undoable. Started or post-apply-changed runs must remain protected in both formats.

**How to apply:** Regression fixtures should seed the actual historical nested shape and include an unchanged future run, a started run, and a post-apply-changed run; assert restoration, skips, stamps, and the persisted undone summary.