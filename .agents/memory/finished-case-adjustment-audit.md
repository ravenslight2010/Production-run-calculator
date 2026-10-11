---
name: Finished-case adjustment audit visibility
description: Keep actor- and reason-bearing freezer adjustment history behind manager authorization without narrowing general stock reads.
---

Adjustment history contains the manager identity and free-text reason. Keep it on a separate facility-scoped read that requires `manage-inventory`; do not append it to a general signed-in surplus response, which ordinary staff already use.

**Why:** Broadening an established operational response can expose manager-only audit detail to staff who only need current stock and run allocations.

**How to apply:** When adding audit detail to an existing inventory read, preserve its current audience and expose the audit through an explicitly authorized, scope-filtered route.

Each finished-case lot also needs a durable internal inventory-item identity, separate from its human/product key. Inventory merges must move that identity to the surviving item; legacy unlinked lots should be associated before later stock movements.

**Why:** A merge replaces the generated inventory key and item ID. Resolving later adjustments by the old key can recreate a second stock item and split its ledger history.

**How to apply:** Keep finished-lot identities out of public API payloads, but remap them in the same merge transaction before inventory lots and ledger entries move.
