---
name: Inventory settings & lot concurrency
description: Why inventory has a global settings row, and how concurrent stock drawdown stays consistent
---

# Configurable expiry lead time

- The "expiring soon" alert lead time is a **user-configurable, server-persisted** setting, not a hard-coded constant. It lives in a single-row global `inventory_settings` table (id=1, default 7 days) with GET/PUT `/inventory/settings`.
- **Why:** the task spec requires "expiring soon (within a configurable lead time)"; a hard-coded `EXPIRY_SOON_DAYS = 7` was rejected in code review. Inventory is shared server-side, so the setting is global (consistent across devices) rather than per-device local storage.
- **How to apply:** `lotExpiryStatus(lot, soonDays = EXPIRY_SOON_DAYS)` takes the lead time as a param. Both web + mobile fetch settings alongside inventory in `load()` and thread `expirySoonDays` down through CategorySection → ItemRow → ItemDetail. The constant remains only as a safe default.

# Lot drawdown must lock rows

- `drawDown` (FIFO/FEFO stock deduction) reads lots then writes per-lot `qtyRemaining`. It MUST run inside a transaction AND select the lot rows with `.for("update")` (SELECT ... FOR UPDATE).
- **Why:** without row locks, two concurrent consume/adjust requests for the same item read the same starting quantities and write conflicting values → lost updates / on-hand vs ledger drift. Flagged as a blocking reliability issue in code review.
- **How to apply:** both callers (consume, adjust) already wrap `drawDown` in `db.transaction`; the FOR UPDATE on the lot select serializes them. Keep any new caller transactional too.

# Contract-first exception

- Inventory clients use hand-written `fetch` wrappers (mirroring the existing `/sync` client), NOT the generated Orval hooks — this is an intentional, plan-approved exception. Server still validates every body with the generated Zod schemas. Don't "fix" this by migrating to hooks.
