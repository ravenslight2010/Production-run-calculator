---
name: Applicator tolerance columns
description: Spec-grid applicator rows carry trailing check/tolerance cells that must never be read as the station weight.
---

Rule: on a spec-sheet applicator row, the station's oz-per-pizza is the FIRST numeric cell after the name; rows often carry trailing small check/tolerance cells (e.g. `name | 2.9 | 0.2 | 0.1`) that are NOT weights. A repeated same-named applicator row is a real second station whose weight is its OWN first cell (often equal to the first station's).

**Why:** the AI parse once took the trailing 0.2 as a second cheese station's weight; the sheet's TARGET WEIGHT column sums (crust+sauce+apps+peps) prove which reading is right — use that sum as the verification trick when a weight looks suspect.

**How to apply:** the parse prompt pins this rule; any prompt change touching applicator weights must keep it and bump SPEC_PARSE_VERSION. When auditing a suspect weight, sum the profile's components against the sheet's TARGET WEIGHT. Same-name dup rows at tiny vs big oz are suspects; DIFFERENT-named small second mixes (e.g. a 0.85 topper mix next to a 4 oz cheese mix) are genuine.
