---
name: Crust runs have no dough batches
description: In crust mode (doughSubTab === "crusts") all dough-batch concepts must be suppressed across web + mobile.
---

# Crust runs mix no dough

A run's supply mode is `doughSubTab` / `run.progress.subTab`: `"dough"` (mix dough,
count batches) vs `"crusts"` (open pre-made crust cases). In crust mode **no dough is
mixed**, so every dough-batch concept must be suppressed.

**Rule:** anything tied to dough batches — the "next batch due / Start next dough
batch" alert (notification + haptics/vibration + the `showBatchDue` banner), batch
countdown timers, "Batches Ready"/"Batch Yield" stats — must NOT appear or fire when
in crust mode. Suppress at the source: the `useNotifications` batch-cycle effect bails
in crust mode AND clears any stale `showBatchDue` (so a banner raised in dough mode
doesn't carry over after switching). Also defensively gate the banner render on the
mode, not just on `showBatchDue`.

**Why:** user reported batch alerts/countdowns showing during crust runs where they're
meaningless. A hook-only suppression isn't enough — a banner already raised in dough
mode persists after switching unless explicitly cleared and the render is mode-gated.

**How to apply:** keep web (`isCrust` param) and mobile (derives from
`run.progress.subTab`) at parity. Web-only casting screens (Dough Station, Floor Mode)
are a parity exception but still must hide/relabel batch widgets in crust mode
(trays→stacks, hide batch tiles, countdown → "no dough batches").
