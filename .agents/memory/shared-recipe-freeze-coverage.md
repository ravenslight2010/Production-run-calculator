---
name: Shared recipe freeze coverage
description: How browser coverage proves linked recipe refreshes without relying on aggregate totals alone.
---

Shared recipe freeze tests should inspect the rendered Ingredient Detail snapshot for both pending and started runs. Mix edits can change per-pizza component proportions while leaving total applicator pounds unchanged, so an aggregate total assertion can miss a stale or partially refreshed mix row.

**Why:** Mix recipes convert component oz/pizza values into normalized run-row pounds; changing one component may preserve the total while changing the ingredient split.

**How to apply:** When adding a shared recipe refresh case, edit through the real Settings manager, compare Ingredient Detail before and after each edit, then reload and assert the started snapshot is unchanged.