---
name: Scheduled runs snapshot the profile
description: Why profile edits made after scheduling never reach scheduled runs, and the blank-fill-only sauce backfill rule.
---

**Rule:** Web scheduled/imported runs store a whole-object snapshot of the brand profile at scheduling time (`stored ?? profile`). Any profile field edited AFTER scheduling never propagates on its own. Mobile's pull-up spreads the CURRENT profile, so mobile never had this gap — web is the side to watch.

**Why:** An operator added a sauce recipe to a profile after the day's runs were imported; applicator fields looked "auto-applied" (they were in the snapshot) while sauce stayed blank, which read as a bug. Root incident also involved poisoned learned import aliases (since deleted) mislabeling Bacon as Bacon Cheeseburger Mix.

**How to apply:** Sauce fields are backfilled from the current profile via `backfillSauceFromProfile` (web storage.ts) at the two rollover pull-up sites and saveScheduledDay. Blank-fill ONLY: fill when frontlineRecipeName is blank AND no frontlineRecipe row has lbs>0; sauceOzPerPizza only when stored ≤0. Never clobber non-empty run values — a populated backfill pushed via schedulePush would otherwise fight the additive sync merge. If other profile fields get the same complaint, extend the same blank-fill pattern rather than switching to whole-profile overwrite.
