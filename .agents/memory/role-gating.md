---
name: Role gating (data-driven capabilities)
description: Roles are now DB rows = name + capability set + builtin flag; how access is gated by capability, the admin/guardrail rules, and what must never be gated.
---

# Role gating (capability model)

Roles are **data-driven**: a role is a DB row with a name, a set of capabilities,
and a `builtin` flag. There is NO hardcoded role ladder anymore. A user's access
is the union of their assigned role's capabilities. First user seen bootstraps as
**manager**; new accounts default to **operator**.

## Capability and role source of truth
The catalog and starter role grants evolve. Read the current capability list and
seed definitions in the server before reviewing access. Seeds create missing
roles; stored definitions are editable and may not match current defaults.

## Server resolution — the test gotcha
`requireCapability` resolves a user's capabilities by looking up their role NAME
in the **roles table** (not from a static map). So an integration test that inserts
a `user_roles` row WITHOUT also seeding the roles table gives even a "manager" zero
capabilities → 403. **Any integration test exercising a capability-gated route must
`await seedRoles()` in `beforeEach`** (dynamic-import it; never static-import
`lib/roles`, which binds the @workspace/db pool before DATABASE_URL is repointed).
Also add the roles table to the test TRUNCATE set.

## Client/server boundary
Use the capability required by the protected API for the matching client control;
role names and broad `isManager` aliases are not substitutes. UI visibility is
convenience only: the server remains authoritative, and open clients need a
bounded refresh path after role edits.

## Role administration (manager = has manage-staff)
CRUD on roles via `/roles` (GET/POST/PUT/DELETE). Managers can create/edit/delete
roles and assign any role. Guardrails:
- **Privilege-escalation guard:** you can't grant a capability you don't hold —
  applied to role create, role edit, AND user-role assignment (`setUserRole`).
- **Owner-approved role edit policy (2026-10-30):** an editor may remove only
  capabilities they currently hold. Keep this boundary separate from the grant
  check; enforce both when editing a role.
- Can't delete a role that is assigned to any user.
- Can't remove the last enabled, non-sandbox `manage-staff` holder. Manager-set
  mutations use a shared transaction-scoped lock so concurrent operations cannot
  strand the team without an enabled manager.
- The builtin **manager** role must always keep `manage-staff`.

Higher-capability account deletion is a separate explicit owner policy; see
`staff-account-deletion-policy.md`. Do not infer its boundary from the generic
role-edit privilege ceiling.

## Collision to avoid
Web `home.tsx` has an UNRELATED client-side PIN "supervisor mode" (local state
`role`/`isSupervisor`). NOT the staff role/capability — never conflate.

## What is NOT gated — and must NOT be
Anything flowing through the shared `/sync` day-state blob (recipe editing, mobile
master-data lists). It is one shared blob, not per-user role-checkable endpoints,
so it can't be cleanly capability-split and gating it would break web/mobile parity.
Restock/adjust/consume stay operator-allowed but quantity-only (never a master-data
backdoor).
