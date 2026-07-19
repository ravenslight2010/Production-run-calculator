---
name: Importer "use existing" redirect aliases
description: How cheese/premix importer redirect picks are remembered and auto-applied on re-import
---

# Importer redirect picks live in the shared "appType" alias namespace

The cheese-recipe importer and premix importer review dialogs each have a per-item
"Use existing recipe/mix" picker. A confirmed pick is saved as a spec-import alias
`{kind:"appType", externalName:<sheet name>, canonicalName:<existing name>, context:null}`
— the SAME namespace the spec importer's cheese/mix "Use existing recipe" picks write.
This is intentional: a blend-name mapping learned in one importer auto-applies in the others.
Note: the SPEC importer now ALSO writes a second brand-scoped row
(context:<brand>) alongside the context:null one so each brand keeps its own
pick for a generic blend name; the context-free row remains the cross-importer
fallback these dialogs read (see `learned-import-aliases.md`).

**Why:** managers re-import the same workbooks; without memory they'd redo every redirect,
and near-dup blends would multiply.

**How to apply:**
- Auto-apply is suggestion-level only: pre-selects the picker in the review dialog; the
  manager can clear it; nothing writes without Apply.
- Alias links take precedence over loose-key/near-dup matching but are still subject to
  the one-to-one claims guard: a target claimed by TWO proposed links drops both, and
  heuristic (loose-key/near-dup) links are also vetoed by the target's own exact-id update.
  ALIAS links are NOT vetoed by the target's own exact-id update — after a Manage Lists
  merge of two blocks from the SAME workbook, a re-import carries the survivor's block
  (exact update) plus the merged-away block (alias → survivor); the review must show that
  link or the merged-away item silently resurrects as "new" on every re-import.
- Conflicting learned mappings (same external name → different canonicals, ci) are dropped
  entirely rather than guessed at; a canonical name matching 2+ existing items is ambiguous
  and links nothing (cheese falls back to same-brand-unique).
- Both dialogs block Apply when two included rows resolve to the same final id
  (duplicate-target warning).
- Premix dialog review keys stay the ORIGINAL parsed ids so freezer-pull notes and
  selection survive a redirect; each Item carries `original` so clearing restores the
  parsed identity.
- Gotcha fixed along the way: the premix aiCorrections mirror must copy only brand/flavor
  alias kinds — mirroring appType entries misfiles blend-name picks as product-name
  corrections.
