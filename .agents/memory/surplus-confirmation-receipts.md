---
name: Finished-case surplus confirmation identity
description: Why explicit none and positive surplus decisions belong to completed runs rather than product/date or UI dismissal.
---

A finished-case surplus decision belongs to one completed run in one data scope. Explicit zero and the No extra cases action mean the same saved outcome; blank is not zero. A positive decision and its stock effects must commit together and exact retries must return the existing outcome. A later refresh failure must not revoke that acknowledgment.

**Why:** Multiple completed runs can share a product and production date. Repeated prompting can lead operators to record the same physical cases again, while product/date-based dismissal could suppress an independent run.

The approved correction policy is manager/inventory-capability-only with a required reason; append-only linked evidence; a revision fence and idempotency key; and atomic stock deltas through the existing inventory accounting path. Reductions may remove only cases still physically available, never allocated, used, damaged, or otherwise unavailable stock. Production-date changes are blocked after any allocation or adjustment and whenever legacy allocation history is unknown. Keep the original receipt and lot history; do not infer run links or backfill prior decisions.

**Why:** Operators need a safe way to correct mistakes, but released allocations, depleted stock, and incomplete legacy history make automatic rewrites capable of duplicating or erasing stock.

**How to apply:** Require explicit manager action and a reason for every correction; use linked append-only events, exact-retry idempotency, and a current-revision check. When stock history cannot prove a date change is safe, reject it rather than infer.

**How to apply:** Preserve run-bound immutable acknowledgment and separate optional reads from save success. Do not associate historical product-only lots with runs by guessing. Editing an already recorded outcome requires an explicit correction policy rather than silently replacing the receipt.

Run-level idempotency does not serialize shared stock totals.

**Why:** Independent completed runs, including runs on opposite sides of midnight, can update the same finished-stock lot while holding different run or daily-snapshot locks. Both receipts and ledger entries can commit even when a stale read/write loses one stock increment.

**How to apply:** Protect shared stock updates independently of receipt uniqueness. Concurrency evidence must include different run identities and different daily snapshots sharing an existing stock lot, not only duplicate submissions of one run.
