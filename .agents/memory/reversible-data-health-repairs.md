---
name: Reversible data-health repairs
description: Durable safety rules for manager-triggered deterministic repair batches and guarded undo.
---

Repair batches should store only the changed fields, their before/after values, and the profile/run LWW stamps. Undo must require both the post-repair stamp and post-repair field values to match; otherwise skip the record rather than overwrite a later edit.

**Why:** Data-health corrections can affect future run snapshots, and a manager needs a recovery path without allowing undo to erase unrelated operational edits or started-run state.

**How to apply:** Keep batch history scope-bound and bounded, append apply/undo audit records after transactional results are known, and preserve compatibility for existing apply summary consumers when extending response details.