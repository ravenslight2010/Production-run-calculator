---
name: Cycle-count reminders
description: Factory-wide cycle-count schedules + warehouse "Time to Count" card; master-data pattern (NOT synced), shared due-logic.
---

# Cycle-count reminders

Managers configure cycle-count schedules (warehouse `section` + `cadenceDays`,
default 7). The Warehouse tab on web AND mobile shows a "Time to Count" card
listing sections due (never counted, or last counted longer ago than cadence).
Marking a section counted stamps `lastCountedAt` and clears it until the cadence
elapses again.

## Shape of the work
- Built by mirroring the **freezer-pull master-data pattern exactly** — that is
  the canonical template for "factory-wide manager config that is NOT in /sync".
  When adding a similar feature, copy freezer-pull (glue, hook, manager
  component, warehouse card, roles integration tests) end-to-end.
- Pure due-logic lives in shared lib `@workspace/cycle-count`
  (`buildCycleCountDueList`, `normalizeCycleCountSchedule(s)`, `daysSince`).
  Both apps call it so web/mobile can't drift.

## Non-obvious decisions
- **Auth split:** reads AND `mark-counted` are `requireAuth` (floor staff perform
  counts); only create/update/delete (POST list / DELETE) are manager-gated
  (`manage-inventory`). The mark-counted route is signed-in, not manager-only —
  this is intentional and is asserted in roles integration tests.
- **Server preserves `lastCountedAt` on the upsert update path** — only the
  dedicated mark-counted endpoint changes it. A plain schedule edit (rename /
  cadence change) must not reset the count clock.
- **Suggestions come from a shared `DEFAULT_CYCLE_COUNT_SECTIONS` constant** in
  the lib (there is no existing warehouse-section master list to draw from), so
  web and mobile offer the same one-tap section names.
- Due-list sort: never-counted first, then `overdueDays` desc, then section.
  `daysSince === null` ⇒ "Never counted"; `overdueDays = 0` for never-counted.
- **Mark-counted stamps the CLIENT's local factory day**, not the server's UTC
  date. The clients build the due list from their local `todayStr()`, so they
  pass that same day to the mark-counted endpoint (request body `{ today }`).
  The server validates it as a real YYYY-MM-DD calendar date and falls back to
  its own date when absent/malformed. **Why:** server stamping UTC vs clients
  computing local day caused a timezone off-by-one in reminder timing — any
  date-stamp that is later compared against a client-local day must be on the
  same local-day basis.

**Why:** parity is mandatory (replit.md) and the freezer-pull pattern already
solved the "factory-wide, not-synced, manager-write/staff-read" shape; reusing
it verbatim keeps both apps identical and the auth boundary auditable.
