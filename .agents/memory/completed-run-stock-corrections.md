---
name: Completed-run stock corrections
description: Durable stock-delta contract when saved completed-run details change after the initial inventory deduction.
---

# Completed-run stock corrections

Reconcile a completed run's changed case count or packaging settings from the canonical before/after saved snapshots, within the serialized sync transaction. Preserve the original expected-consumption baseline and attribute only the remaining delta to that run's inventory ledger. For legacy claims without a baseline, use the previous canonical snapshot on the first correction.

When inventory items are merged, remap every affected completed-run baseline to the surviving item ID in the same transaction and sum source and target quantities. Keep the existing run ledger rows; they are the evidence used to calculate the remaining correction.

**Why:** Inventory consumption is claimed once per run, so replaying the full new requirement would double-deduct, while a separate non-atomic correction can race with sync writes or be lost on retry.

**How to apply:** Keep the baseline's inventory identity aligned when stock records are merged, then derive corrections from that baseline plus preserved ledger history. Any new post-completion field that affects stock must update the same canonical run state used for normal consumption and reconcile only its difference transactionally. Keep identical retries no-ops and retain the source run ID on each correction entry.
