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

Recoverable browser commands are bound to the authenticated user and live/sandbox scope. Retry eligibility is a persisted deadline, rate-limit waits cannot be manually bypassed, and a sending record is neither retryable nor discardable. Cross-tab delivery uses a renewable lease plus a per-attempt token; every post-network transition must still match both the captured identity and token.

**Why:** A late response after sign-out or lease loss can otherwise adopt another scope's canonical state, resurrect a terminal command, or lift an End fence before atomic finalization. Event-only retries also strand work when connectivity stays online after a transient server failure.

**How to apply:** Schedule one wake-up for the earliest retry deadline, keep review-required records outside terminal-history eviction, quarantine legacy unowned records until explicit recovery, and keep blocked or rejected Ends fenced until retry or explicit discard.

Reset cleanup must preserve the operational-intent namespace, and a cross-tab lease must retain the exact storage key it acquired even if auth identity changes while delivery is in flight.

**Why:** Broad legacy browser-key prefixes can erase still-reviewable commands during a reset, while deriving lease cleanup from the current identity strands a valid lock after sign-out and blocks the next authenticated session.

**How to apply:** Exclude durable operational keys explicitly from reset wipes, and release/renew leases using the captured owner key rather than live auth state.