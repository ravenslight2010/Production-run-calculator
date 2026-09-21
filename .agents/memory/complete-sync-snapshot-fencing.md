---
name: Complete sync snapshot fencing
description: Causal protection for complete day-state writes from offline clients with skewed clocks.
---

Versioned complete day-state writes identify the exact canonical snapshot they were based on. Validate that identity while holding the daily-row lock; on mismatch, return the complete canonical state without applying the incoming write so the client can rebase.

**Why:** Per-field timestamps are not causal. An offline tablet with a fast clock can otherwise overwrite a newer canonical edit it never observed.

**How to apply:** Keep reset fencing and partial-delta snapshot checks separate. Preserve legacy unversioned compatibility only where explicitly required, and ensure maintained clients include the base snapshot on complete writes.

Canonical revisions advance only when the locked canonical document actually changes. An accepted protected merge that preserves the current document must still emit conflict evidence, but must not consume a revision.

**Why:** Operational commands and document writes share one ordering signal. Counting no-op protection outcomes as state changes creates false ordering, while suppressing their accepted-write signal loses evidence that a dangerous overwrite was blocked.

**How to apply:** Compare snapshot identities under the row lock, persist the increment with the changed document, and keep canonical-change detection separate from conflict logging and compatibility acknowledgements.