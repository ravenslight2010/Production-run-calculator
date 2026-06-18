---
name: Role gating (manager/operator)
description: What is and isn't gated by manager/operator roles, and why.
---

# Manager/operator role gating

Roles live in the DB keyed by Clerk userId. First user to be seen bootstraps as
manager, everyone else operator. The role-resolution helper creates the row on
first sight, so the `/me`-style role hook also bootstraps.

## What IS gated (server-enforced, manager only)
- inventory item create / metadata-edit / delete (includes reorder-threshold edit)
- AI photo intake (paid action)
- inventory settings (expiry lead time)
- staff role admin (list users, change a user's role) — with a last-manager guard

UI hides these for operators on BOTH web and mobile (parity).

## Daily-ops writes stay operator-allowed — but must not become a master-data backdoor
Restock / adjust / consume are open to operators. **Restock must be
quantity-only: it must never overwrite an existing item's name/unit/category,
and creating a brand-new item through restock is master-data creation, so it is
manager-gated.**

**Why:** an earlier version upserted item metadata on every restock, which let
an operator create or overwrite master data through an ungated path (broken
access control). Any "convenience upsert" on an operator-reachable write is a
gating hole.

**How to apply:** when an operator-reachable endpoint touches an items/master
table, make it look-up-only for existing rows and gate any insert/update of
master fields behind a manager check.

## What is NOT gated — and must NOT be
Anything flowing through the shared `/sync` day-state blob (recipe editing,
mobile master-data lists like brands/flavors/recipe ingredients/saved mixes).

**Why:** day-state is one shared blob, not per-user role-checkable endpoints, so
it can't be cleanly role-split; and there is no web equivalent to gate, so
gating it mobile-only would break the strict web/mobile parity preference.

**How to apply:** gate a new control only if it hits a manager-protected
endpoint. If it writes via /sync, leave it operator-accessible.
