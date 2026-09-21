---
name: Complete sync snapshot fencing
description: Causal protection for complete day-state writes from offline clients with skewed clocks.
---

Versioned complete day-state writes identify the exact canonical snapshot they were based on. Validate that identity while holding the daily-row lock; on mismatch, return the complete canonical state without applying the incoming write so the client can rebase.

**Why:** Per-field timestamps are not causal. An offline tablet with a fast clock can otherwise overwrite a newer canonical edit it never observed.

**How to apply:** Keep reset fencing and partial-delta snapshot checks separate. Preserve legacy unversioned compatibility only where explicitly required, and ensure maintained clients include the base snapshot on complete writes.