---
name: Doughball variants on family dough recipes
description: One dough family recipe carries all variants' doughball weight/per-tray; auto-match + manual pick rules and gotchas.
---

One pool dough recipe per FAMILY carries every variant's doughball numbers as `doughballVariants` (label + weightOz + perTray) instead of minting per-variant recipes.

Rules:
- The parse prompt must demand ONE dough recipe per yield-table ROW: the model otherwise groups customers with matching weights into combined labels ("Hannaford, Lowe's, & SMD CRB") and drops the rest as "a subset". Any prompt change here bumps SPEC_PARSE_VERSION.
- Merging is additive by label (ci): new labels append, existing labels' values are UPDATED by an incoming re-import (a re-import states the current spec), never removed.
- Auto-match at dough pick is conservative: exactly 1 variant, or the die size's number token appears in EXACTLY one label; anything ambiguous → null and the run form shows a manual pick banner.
- Variant values win over the recipe-level doughballWeightOz/doughballsPerTray, but ALL fill paths (pick handler, self-heals, manual pick) stay blank-fill-only — never overwrite an operator-typed value (per-flavor invariant).

**Why:** spec sheets share one dough recipe across many die sizes; per-variant recipe copies drifted and cluttered pickers.

Consumers: the run form AND the Setup Profiles editor both do variant match at dough pick, PLUS dieType-keyed self-heal effects (die size may be set AFTER the recipe pick — a pick-time-only match misses it).

Exception: the Setup Profiles editor has a persistent variant SWITCHER (shown when the picked dough recipe has 2+ variants) where an EXPLICIT user pick overwrites weight/per-tray — but a variant field of 0 means "not recorded" and never clobbers a real profile value.

Ambiguity guards (same-named targetless variant ROWS in a parse, and multi-variant POOL recipes): a name-only relink or pool hydration must never take a doughball number it can't attribute — planner/apply only accept a row whose weight matches the profile's known weight (±0.005); pool hydration only fills via a die-type variant match; multi-variant + no match = fill NOTHING (recipe-level numbers belong to no customer). A recipe-level value (e.g. 13oz) can ALSO be a legit variant's value — a de-poison heal must require "no variant carries it" before clearing.

**How to apply:** any new consumer of dough weight/per-tray should call `matchDoughballVariant` first, fall back to recipe-level, and keep blank-fill-only. Gotcha: a pending manual-pick prompt MUST be cleared whenever the recipe name changes or the weight fills by another path, or the operator can apply the previous family's numbers to the wrong run.
