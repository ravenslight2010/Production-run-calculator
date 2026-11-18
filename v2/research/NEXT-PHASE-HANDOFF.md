# V2 Next-Phase Handoff for Replit

**Date:** 2026-11-18  
**Source:** Comparison of V1 (`main`) vs V2 on the `Replit` branch (`v2/`).  
**Purpose:** Map the remaining operational features from V1 that are outside the approved first-release scope, plus the architectural improvements V2 should keep or strengthen.

This is a planning handoff. It does not authorize cutover or data transfer.

---

## 1. Full QC Department

**V1 reference:** `docs/qc-department-plan.md` (archived; not first-release scope).  
**V2 status:** Not implemented.

### What to build
- QC station or panel with:
  - Brix testing entry and history
  - HACCP checkpoints (temperature, time, corrective actions)
  - Quality check records tied to a run and station
  - Manager quality history view
  - Ability to flag a run or lot for review
- Server-owned records (same pattern as station progress): revision, idempotency, events.
- Role gate: QC manager / supervisor capability.
- Do not carry V1 historical QC data at cutover. Start fresh.

### Acceptance
- Disposable PostgreSQL tests for create/read/update of Brix and HACCP records.
- Browser test for QC entry on a run and manager history view.
- No silent overwrite of a prior check; corrections are new records or explicit revisions.

---

## 2. Account Reset

**V1 reference:** Password-reset approval queue in staff roster; manager capability.  
**V2 status:** Account admin exists; full reset-approval flow does not.

### What to build
- Staff can request a password reset.
- Manager sees a pending-reset queue (part of manager attention or staff panel).
- Approve → temporary code or forced change on next login.
- Deny → clear the request.
- All actions revoke existing sessions for that account.
- Rate-limit requests and approvals.
- Never log reset codes or tokens.

### Acceptance
- Disposable tests for request → approve → new login, and request → deny.
- Session revocation verified.
- Role denial for non-managers.

---

## 3. Full Schedule Import

**V1 reference:** Schedule import with multi-day support and partial-failure handling.  
**V2 status:** CSV templates and some setup-family imports exist; full schedule family is limited.

### What to build
- Manager-reviewed schedule import:
  - Preview parsed days/runs
  - Show conflicts with existing scheduled work
  - Explicit Apply (no silent overwrite)
  - Partial success reporting (which days applied, which failed)
  - History of applied imports
- Support the same source families already mapped in `v2/research/v1-import-source-matrix.md`, plus the schedule family.
- Idempotent Apply; safe retry after lost response.

### Acceptance
- Synthetic fixtures for clean, partial, and conflicting schedules.
- Browser test for preview → Apply → reload persistence.
- No deletion of existing runs inferred from a missing source row.

---

## 4. Die Defaults

**V1 reference:** Die defaults in Manage Lists & Settings; used by run setup.  
**V2 status:** Limited or not surfaced.

### What to build
- Manager-editable die defaults (per die type or line).
- Used when creating or editing a run setup.
- Server-validated; changes are audited.
- Scope-isolated to the facility.

### Acceptance
- CRUD tests.
- Run setup picks up the current default.
- Role denial for non-managers.

---

## 5. Freezer Pull

**V1 reference:** Freezer-pull configuration and reminders.  
**V2 status:** Not highlighted in current V2 source.

### What to build
- Manager configuration of freezer-pull items and timing.
- Operational reminder or checklist on the relevant station (or warehouse).
- Server-owned; not a client-only timer.
- Tied to run or day where appropriate.

### Acceptance
- Config save/load tests.
- Reminder appears when conditions are met.
- No duplicate reminders after refresh.

---

## 6. Cycle Counts

**V1 reference:** Cycle-count schedules and inventory alerts.  
**V2 status:** Inventory ledger exists; cycle-count UI/scheduling is thin.

### What to build
- Manager can define cycle-count schedules (by location or item class).
- Warehouse/inventory view shows due or overdue counts.
- Count entry updates the ledger with a receipt (same pattern as opening counts).
- Shortages or variances are recorded, not silently adjusted.

### Acceptance
- Schedule + due detection tests.
- Count → ledger update is idempotent and receipted.
- Role checks.

---

## 7. Allergen and Substitutions

**V1 reference:** Allergen badges on runs; recipe substitution badges and handling.  
**V2 status:** Not highlighted.

### What to build
- Allergen flag on products/recipes; visible badge on the run and relevant stations.
- Substitution support:
  - Manager or authorized user can mark a substitution for a run.
  - Badge shows on affected stations.
  - Inventory consumption respects the substitution (or records it explicitly).
- Do not rely on color alone for the badge.

### Acceptance
- Badge appears when allergen or substitution is present.
- Consumption path is tested with and without substitution.
- Accessible (text + icon).

---

## 8. Mix Plan

**V1 reference:** Operational Mix Plan (make-day view) vs Mix Recipes (master data).  
**V2 status:** Not highlighted as a distinct operational view.

### What to build
- Operational Mix Plan view:
  - Shows make-day needs based on scheduled/active runs.
  - Highlights missing oz/pizza amounts or incomplete mixes.
  - Distinct from the master-data Mix Recipes editor.
- Read-only for operators; edit path goes through setup/catalog with proper role.

### Acceptance
- View reflects current schedule/run state.
- Missing-data warnings appear.
- Naming is clear (Mix Plan vs Mix Recipes).

---

## 9. App Updates

**V1 / recent Replit work:** App update control moved into More menu with accessible dialog.  
**V2 status:** Recently improved on the Replit branch; confirm it is solid.

### What to keep / strengthen
- Update check and prompt live in the More / overflow area.
- Accessible dialog (keyboard, focus trap, Escape).
- Fallback if the update mechanism is unavailable.
- Do not block production work for a non-critical update.
- Service worker / PWA update path is tested.

### Acceptance
- Browser test for the update dialog.
- Reduced-motion and keyboard paths covered.
- No data loss on update/reload.

---

## 10. E2E Matrix

**V1 reference:** `docs/test-release-matrix.md` and Playwright lanes.  
**V2 status:** Desktop/phone emulated tests exist; physical devices, WebKit, and full manager journeys are NOT RUN or BLOCKED.

### What to build
- Minimum for first release:
  - Authenticated manager journey (import → count → run → completion) on disposable DB.
  - Two-session stale-write and wake/reconnect.
  - Station workflows on phone-sized viewport.
- Next:
  - WebKit smoke (or documented BLOCKED with reason).
  - Physical Android/iOS when a device endpoint is available.
  - Accessibility smoke on key screens.
- Keep evidence labels honest (PASS / NOT RUN / BLOCKED). Do not claim physical-device coverage from emulation.

### Acceptance
- The matrix in `v2/research/` or a new `v2/e2e/` doc lists each lane, command, and current status.
- CI or manual release check runs the bounded set.

---

## 11. Architectural “Could Do Better” Items to Preserve

These are already better in V2 than V1. Do not regress them.

| Item | Guidance |
|------|----------|
| **Server-owned auto-track** | Worker advances progress. Clients only refresh. Never let the browser submit ticks. |
| **Revisions + idempotency + outbox** | Keep atomic state change + receipt + event + outbox. |
| **Import staging** | Preview → explicit Apply. No silent overwrite or deletion from missing rows. |
| **Schema isolation** | V2 objects stay in schema `v2`. No access to V1 schemas, credentials, or sessions. |
| **Read-only offline** | Cached read is fine. Writes wait for reconnect and server confirmation. |
| **Fractional dough yield** | Already supported. Keep the tests. |
| **Background worker** | Leased station processing. Make health observable. |
| **Cutover discipline** | Setup/master data + roles only. Fresh physical inventory count. No historical runs. |
| **Station math verification** | Keep verifying against workbook examples when formulas change. |
| **Least privilege** | Role checks on every mutation. Session revocation on account changes. |

---

## Suggested order for Replit

1. Account reset (unblocks staff operations)
2. Full schedule import (unblocks planning)
3. Die defaults + freezer pull + cycle counts (inventory completeness)
4. Allergen and substitutions (safety and production accuracy)
5. Mix Plan (operational clarity)
6. QC department (new capability; can follow core inventory)
7. App updates polish + E2E matrix expansion
8. Continuous reinforcement of the architectural items above

---

## Out of scope for this handoff
- AI features (anomaly, memory, insights, etc.)
- Incidents / reported-issues queue (unless added later)
- Proactive browser-notification preferences
- Cast to screens / Floor Mode
- Sandbox mode
- Historical data migration

These can be separate follow-ups after the items above are stable.

---

## References
- `v2/HANDOFF.md`
- `v2/research/gaps.md`
- `v2/research/v1-to-v2.md`
- `v2/research/v1-import-source-matrix.md`
- V1 `docs/qc-department-plan.md` (policy context only; do not treat as authorization)
- V1 `docs/test-release-matrix.md`
