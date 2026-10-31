---
name: Guarded Undo dependency membership
description: Fence references introduced after a shared master-data action, including alternate profile setups.
---

Undo dependency membership must cover every canonical reference container used
by the forward mutation, not only the rows included in its before/after facts.

**Why:** A later profile can reference a renamed recipe only through its alternate
crust setup. That profile did not exist in the original facts; omitting the
alternate container from membership detection lets compensation remove a name
that newer work still uses.

**How to apply:** When adding a reference-bearing container, update the forward
rewrite and dependency membership together. Regressions should introduce a new
dependent row after the original action, require a conflict, and compare all
canonical records, revisions and invalidations to prove no partial compensation.
Check nested ingredient rows as well as recipe-name fields. Keep production
history and inventory under their separate protected-dependency rules.
