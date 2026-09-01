---
name: Production-line canvas reference
description: Physical production flow, station relationships, lane behavior, and color conventions captured in the user's canvas map.
---

The production line is a U-shaped physical flow:

- Main production travels right-to-left: Press → Oven → Sauce app → App 1 → App 2 → Pep 1 → Pep 2 → App 3 → App 4.
- Product then drops from App 4 into the Freeze tunnel, followed by Wrapper → Packaging.
- Press and Oven move pizzas down side by side.
- The Freeze tunnel also carries pizzas side by side.
- Every other line section is single-file.

Upstream support flow:

- Standby dough → Dough mixer → Dough hopper.
- Dough tray lifecycle: Filling dough trays → Standby dough trays → Using dough trays.
- Each tray section holds a maximum of 20 trays.
- Sauce area feeds down to the Sauce app.

Visual conventions from the reference:

- Black = dough preparation and tray handling.
- Red = sauce-related stations or flow.
- Yellow = applicator and pepperoni stations.
- Grey = Oven and Press.
- Blue = Freeze tunnel.
- Green = Wrapper and Packaging.

**Why:** The canvas reflects the factory's physical handoffs and capacity constraints, not just the application's navigation. Preserving these relationships prevents future UI, reporting, or workflow work from implying the wrong line direction or lane width.

**How to apply:** Use this as the source of truth when designing station views, material-flow diagrams, warehouse handoffs, production calculations, or future canvas references. Keep the right-to-left main line, the App 4-to-freezer handoff, the two-wide exceptions, and the single-file default explicit.