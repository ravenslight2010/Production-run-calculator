---
name: Spec-import alias hygiene
description: Digit-signature + generic-name guards on learned spec aliases; fuzzy matches are never learned; poison purged via one-time heal.
---

# Spec-import alias hygiene

Rules (all enforced in `@workspace/spec-import` `sanitizeSpecAliases`, applied on EVERY alias read/apply path — canonicalize, blend alias application, premix redirects):

- **Digit-signature mismatch aliases are dropped** for brand/flavor/appType/pepType: an alias whose external and canonical names have different digit signatures (e.g. `"11 IN FOUR HANDS" → "Four Hands"`, `Lowe's 7" → Lowe's`) is never applied. Names differing by digits are DIFFERENT products; this is the fix for the Lowe's vs Lowe's 7" brand collapse.
- **Generic slot-type names** ("Mix"/"cheese") are rejected on either side of appType aliases.
- **Chains/cycles** (a name that is both alias source and target) are removed.
- **Fuzzy matches are NEVER learned** (`collectSpecAliases` skips `source === "fuzzy"`): unconfirmed fuzzy guesses written to factory-wide memory were the root cause of poison aliases. Only user-confirmed renames and applied aliases are learned.

**Why:** learned aliases are factory-wide and permanent — one bad fuzzy guess silently rewrote every future import (brand collapse, cross-brand Red Hot mix confusion).

**How to apply:**
- Any NEW code path that reads/applies spec aliases must go through `sanitizeSpecAliases` (it preserves survivor object identity, so `Set` membership works for drop detection).
- An explicit user rename that drops/changes digits (e.g. renaming "Four Hands 11" → "Four Hands") will be learned but BLOCKED at apply time by the digit guard — this is intentional; tests lock it in.
- Rows themselves were purged once via the marker-guarded heal `spec-alias-hygiene-purge-v1` in api-server dataHeals (per-scope grouping so chain detection only sees aliases applied together). If the sanitize rules tighten again, ship a new heal id (v2) — old markers won't re-run.
- Deferred (architect suggestion): sanitize at alias SAVE time too, and integration tests for heal scope-isolation/idempotency.
- **Deleted names must be excluded from the import match universe AND from alias targets.** The digit guard folds number WORDS to digits ("four"→"4"), so a renamed flavor ("4 Cheese Meltdown") legally matches a deleted old one ("FOUR CHEESE MELTDOWN") — the import then lands under tombstoned names the user can't see and autofill finds nothing. Fix: the known-lists glue filters brands/flavors through the deletion tombstones (stamp-arbitrated), and fetched aliases whose canonical brand/flavor is deleted are dropped before use. Any fix like this needs a SPEC_PARSE_VERSION bump — saved parses have the bad grounding baked in.
