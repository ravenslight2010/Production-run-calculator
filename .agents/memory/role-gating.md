---
name: Role gating (7 roles, two ladders + flat ops roles)
description: The role model (operator/supervisor/manager + qc-operator/qc-manager + warehouse/inventory), what each tier can do, and what must never be gated.
---

# Role gating

Roles live in the DB (`user_roles.role`, free-text — adding roles needs NO
migration) keyed by userId. First user to be seen bootstraps as **manager**,
every new account is **operator**. The role-resolution helper creates the row on
first sight, so the `/me`-style role hook also bootstraps.

## The role model — two ladders + flat operator-level roles (7 total)
- **Main ladder (rank-ordered):** operator < supervisor < manager. `mainRank()`
  drives `requireRole(min)` — a caller passes when `mainRank(role) >= mainRank(min)`.
- **QC track:** qc-operator < qc-manager. QC roles sit at **operator level on the
  main ladder** (mainRank == operator), so today they get NO elevated main-ladder
  powers. `requireQcRole` plumbing exists but is unused — reserved for future QC
  powers. Don't wire QC powers without a real requirement.
- **Flat operator-level roles:** `warehouse` and `inventory`. mainRank == 1
  (operator), qcRank == 0 (off the QC track). They are pure job labels — same
  access as a plain operator (run needs, restock/incoming counts, consume/adjust,
  low-stock alerts) and NOTHING gated. No new booleans in the `useRole` hooks:
  they resolve to isManager=false / isSupervisorOrAbove=false / isQc=false, i.e.
  operator-level by omission. Don't grant them item CRUD, reorder-threshold, or
  inventory settings — the user explicitly chose flat roles.

**Why:** lets QC and warehouse/inventory be tracked/labeled independently without
granting production authority. Adding a flat role = extend `Role`/`ROLES` + both
rank maps (mainRank 1, qcRank 0) + both OpenAPI enums (StaffMember.role +
StaffRoleUpdate) + the `Role` type in each app's inventoryShared + the role
pickers (web `<option>`s, mobile `ROLE_OPTIONS`). No requireRole/guard edits and
no DB migration needed.

## What IS gated
**Supervisor-or-above** (the 3 manager powers supervisors gained):
- inventory item create / metadata-edit / delete (includes reorder-threshold edit)
- inventory settings (expiry lead time)
- password-reset approval queue (GET/approve/decline password-reset-requests)

**Manager-only** (unchanged):
- staff roster admin (list users, change role, reset password, remove member)
- AI paid actions (photo intake, merge, optimize, forecast, etc.)
- production rules CRUD, incidents review

UI gating is by capability on BOTH web and mobile (parity): `isSupervisorOrAbove`
for the 3 supervisor powers, `isManager` for the rest. **`usePendingResetCount`
is gated `isSupervisorOrAbove`** (matches the endpoint).

### StaffRolesCard is split internally
The card renders for `isSupervisorOrAbove` (so supervisors see the reset queue),
but the **staff roster section is wrapped in `isManager`** and the roster query
(`GET /users`) is `enabled: isManager` — a supervisor firing it would 403. The
role picker offers all 5 roles (web `<select>`; mobile is a wrapping multi-button
toggle driven by `ROLE_OPTIONS`, not the old binary operator/manager toggle).

## Last-manager guard
Blocks demoting OR deleting the only manager to ANY non-manager role (guard is
`role !== "manager"`, not `role === "operator"`) — so supervisor/qc-operator/
qc-manager are all rejected too. Two managers must exist before one can be moved.

## Collision to avoid
Web `home.tsx` has an UNRELATED client-side PIN "supervisor mode" (local state
`role`/`isSupervisor`). That is NOT the staff role — never conflate it with the
server `supervisor` role / `isSupervisorOrAbove` capability.

## What is NOT gated — and must NOT be
Anything flowing through the shared `/sync` day-state blob (recipe editing,
mobile master-data lists like brands/flavors/recipe ingredients/saved mixes).
Restock/adjust/consume stay operator-allowed but must be quantity-only (never a
master-data backdoor — gate any insert/update of master fields).

**Why:** day-state is one shared blob, not per-user role-checkable endpoints, so
it can't be cleanly role-split; gating it would break strict web/mobile parity.

**How to apply:** gate a new control only if it hits a role-protected endpoint.
If it writes via /sync, leave it operator-accessible.
