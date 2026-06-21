---
name: Role gating (data-driven capabilities)
description: Roles are now DB rows = name + capability set + builtin flag; how access is gated by capability, the admin/guardrail rules, and what must never be gated.
---

# Role gating (capability model)

Roles are **data-driven**: a role is a DB row with a name, a set of capabilities,
and a `builtin` flag. There is NO hardcoded role ladder anymore. A user's access
is the union of their assigned role's capabilities. First user seen bootstraps as
**manager**; new accounts default to **operator**.

## The 6 capabilities
`manage-staff`, `manage-inventory`, `edit-production-rules`,
`approve-password-resets`, `review-incidents`, `use-ai-tools`.

## Seeded roles (only created if absent — additive seed)
- **manager** — all capabilities, builtin + protected.
- **operator** — no capabilities, builtin.
- **supervisor** — review-incidents + edit-production-rules (editable).
- **qc-operator** — use-ai-tools.
- **qc-manager** — use-ai-tools + review-incidents.
- **warehouse** — none.
- **inventory** — manage-inventory.

## Server resolution — the test gotcha
`requireCapability` resolves a user's capabilities by looking up their role NAME
in the **roles table** (not from a static map). So an integration test that inserts
a `user_roles` row WITHOUT also seeding the roles table gives even a "manager" zero
capabilities → 403. **Any integration test exercising a capability-gated route must
`await seedRoles()` in `beforeEach`** (dynamic-import it; never static-import
`lib/roles`, which binds the @workspace/db pool before DATABASE_URL is repointed).
Also add the roles table to the test TRUNCATE set.

## Capability → UI gate map (web + mobile parity)
- **manage-inventory:** inventory add/settings/delete/reorder-threshold.
- **approve-password-resets:** `usePendingResetCount`, StaffRolesCard reset queue.
- **manage-staff:** StaffRolesCard roster + the roles editor; also the `isManager`
  alias used for OUT-OF-SCOPE /sync gates (mobile ExcelImportModal, master-data,
  configure) + web home PIN bypass.
- **review-incidents:** `useUnreviewedIncidentCount`, incidents tab/badge.
- **use-ai-tools:** assistant advanced, quality, fill-missing bulk, voice advanced.
- `isManager` is now an alias for `hasCapability("manage-staff")`.

## Role administration (manager = has manage-staff)
CRUD on roles via `/roles` (GET/POST/PUT/DELETE). Managers can create/edit/delete
roles and assign any role. Guardrails:
- **Privilege-escalation guard:** you can't grant a capability you don't hold —
  applied to role create, role edit, AND user-role assignment (`setUserRole`).
- Can't delete a role that is assigned to any user.
- Can't remove the **last `manage-staff` holder** (error: "Cannot remove the last
  staff manager — assign someone else first.") — covers demotion and deletion.
- The builtin **manager** role must always keep `manage-staff`.

## Collision to avoid
Web `home.tsx` has an UNRELATED client-side PIN "supervisor mode" (local state
`role`/`isSupervisor`). NOT the staff role/capability — never conflate.

## What is NOT gated — and must NOT be
Anything flowing through the shared `/sync` day-state blob (recipe editing, mobile
master-data lists). It is one shared blob, not per-user role-checkable endpoints,
so it can't be cleanly capability-split and gating it would break web/mobile parity.
Restock/adjust/consume stay operator-allowed but quantity-only (never a master-data
backdoor).
