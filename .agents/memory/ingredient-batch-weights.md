---
name: Learned ingredient batch weights
description: Factory-wide server memory of typed "Batch Weight (lbs)" per plain ingredient; auto-fill on pick, visibility-gated debounced learn.
---

# Learned per-ingredient batch weights

Mixes and cheese recipes carry their batch weight from their recipe rows; plain
ingredients (applicator toppings, non-default pep types, ready-made sauce
barrels) only have a manually typed "Batch Weight (lbs)" field. Once entered,
the weight is remembered server-side (`ingredient_batch_weights`, ci-keyed by
name, scope column, requireAuth-only — the fill-missing learned-store pattern)
and auto-filled the next time the ingredient is picked on any device.

**Rules that matter (learned the hard way / by design):**
- **Learn only VISIBLE fields.** The debounced save must apply the exact same
  visibility rules the UI uses (not a mix name, not a recipe-backed slot with
  rows lbs>0, not a default stick-pep type, pep2 slots skipped while
  pep1Combined) or stale hidden form values get remembered as real weights.
- **Sauce branch: check recipe rows lbs>0, not row-array truthiness.** The
  server sauce map can return an EMPTY rows array — treating any array as
  "recipe-backed" silently skips ready-made barrel auto-fill.
- **Serialize saves.** Debounced fire-and-forget POSTs race: an older slow
  request can land after a newer one and regress the weight. Chain them on a
  ref (`prev.then(save)`), so writes hit the server in entry order.
- Gate the learn effect on the learned-list query having loaded, or every
  mount blind-resaves whatever the form already holds.
- Applying on pick reads the learned map through a ref so the inline JSX
  dropdown handlers never capture a stale map.

**Why:** the user asked that "the weight follows the ingredient" like mixes /
cheese recipes carry theirs; any weight the crew types becomes shared memory
with no confirm step, so the visibility gates are the only thing preventing
garbage from being learned.
