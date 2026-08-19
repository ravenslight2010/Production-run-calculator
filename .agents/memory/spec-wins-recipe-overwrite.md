---
name: Spec-wins recipe overwrite
description: Spec re-import always overwrites recipe content; no update-existing opt-in; prune never demotes recipes; ingredient names resolve through merge history before ANY write.
---

**Rule:** The spec sheet is the source of truth for recipe CONTENT. Re-import always overwrites dough/sauce recipe rows and spec-derived mix per-pizza values (positive values overwrite; zero/absent never zeroes). A manager-added cellulose component is the exception: retain it when a spec or premix sheet omits it, but let an explicitly supplied cellulose row win. The snapshot-prune step must never demote recipes to reference-only — only profile scalars are pruned. A linked cheese recipe (or any recipe with no usable sheet rows) stays reference-only, and cheese pool per-batch pounds stay protected (units mismatch: sheets are per-pizza oz).

**Why:** Wrong amounts/ingredients from a prior bad import survived a correcting re-import unless the manager knew to opt into "update existing" — a silent-wrong-data incident class.

**How to apply:** Any new import/apply path must (1) let spec content overwrite without an opt-in flag, except for the cellulose-preservation rule, and (2) resolve recipe row ingredient names through the factory merge history ONCE, before the local apply, so local presets/ingredient lists and server pools see the same canonical names (resolving only at the pool write resurrects merged-away names client-side). Recipe/type-shape changes here require a SPEC_PARSE_VERSION bump.
