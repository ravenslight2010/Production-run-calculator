---
name: Offline operational intents
description: Durable rules for reconciling floor actions recorded while browsers or networks are unavailable.
---

All writers that can create or replace a daily production snapshot must establish and lock the scope reset-generation row first, validate the expected epoch while holding that lock, and only then lock or write the daily row. Reset and purge paths use the same lock order before deleting state.

**Why:** Checking an epoch before the write transaction leaves a reset race where stale state can be inserted after the reset deleted the old row. Different lock orders also create deadlocks.

**How to apply:** Use reset-generation → daily state → command ledger as the shared lock order for snapshots, offline commands, resets, and full purges.

Pending browser commands are stored under independent stable-ID keys. Never rebuild or delete the whole pending set from a previously read aggregate.

**Why:** Local storage read-modify-write is not atomic across tabs; one tab can erase another tab's newly queued floor action.

**How to apply:** Append and terminalize only the exact command key. Keep terminal display history bounded separately, while pending commands are never evicted.

A review-required or conflict-rebased response must force the affected canonical lifecycle or counter fields into local persistence before ordinary last-writer-wins reconciliation runs.

**Why:** Generic inbound merge intentionally preserves newer local edits. Without intent-aware replacement, the rejected projection is retained and uploaded again, bypassing manager review.

**How to apply:** Replace only the fields owned by the command, preserve unrelated edits, reset their local stamps to the canonical stamps, then run the normal inbound merge.

Run completion is one durable server finalization command. While it is pending, the optimistic local End must be fenced out of ordinary snapshots using a retained pre-End lifecycle copy. The server commits lifecycle, inventory marker/drawdown, retained day state, and command outcome in one transaction.

**Why:** Separate End and inventory requests can leave a canonically completed run without inventory consumption. Stripping only `endedAt` is insufficient for a paused run because clearing its pause fields can accidentally resume canonical tracking.

**How to apply:** Capture the complete bounded pre-End lifecycle before optimistic mutation, publish that lifecycle while completion is pending, and let stable command IDs make retries exactly-once across instances.