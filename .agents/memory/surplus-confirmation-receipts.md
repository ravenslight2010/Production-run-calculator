---
name: Finished-case surplus confirmation identity
description: Why explicit none and positive surplus decisions belong to completed runs rather than product/date or UI dismissal.
---

A finished-case surplus decision belongs to one completed run in one data scope. Explicit zero and the No extra cases action mean the same saved outcome; blank is not zero. A positive decision and its stock effects must commit together and exact retries must return the existing outcome. A later refresh failure must not revoke that acknowledgment.

**Why:** Multiple completed runs can share a product and production date. Repeated prompting can lead operators to record the same physical cases again, while product/date-based dismissal could suppress an independent run.

**How to apply:** Preserve run-bound immutable acknowledgment and separate optional reads from save success. Do not associate historical product-only lots with runs by guessing. Editing an already recorded outcome requires an explicit correction policy rather than silently replacing the receipt.

Run-level idempotency does not serialize shared stock totals.

**Why:** Independent completed runs, including runs on opposite sides of midnight, can update the same finished-stock lot while holding different run or daily-snapshot locks. Both receipts and ledger entries can commit even when a stale read/write loses one stock increment.

**How to apply:** Protect shared stock updates independently of receipt uniqueness. Concurrency evidence must include different run identities and different daily snapshots sharing an existing stock lot, not only duplicate submissions of one run.
