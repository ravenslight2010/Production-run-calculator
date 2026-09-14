---
name: React Day Picker v10 wrapper contract
description: Migration details that matter when maintaining copied calendar wrappers against React Day Picker v10.
---

React Day Picker v10 removes deprecated class-name compatibility keys from
`classNames`. Copied shadcn-style wrappers must map the month table styling to
`month_grid` and retain the library's default class for that slot.

**Why:** v9 accepted deprecated aliases that v10 rejects at the type boundary;
leaving `table` in a shared wrapper can break the build or silently lose the
library's default grid styling during an upgrade.

**How to apply:** When upgrading a copied wrapper, check the v10 migration
table before editing component slots. Keep the current `button_previous`,
`button_next`, `DayButton`, `Chevron`, and formatter contracts unless the
compiler identifies a real mismatch. Verify the wrapper with browser checks at
desktop and phone widths.