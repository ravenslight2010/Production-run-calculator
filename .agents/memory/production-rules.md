---
name: Production Rules (manager-editable)
description: Factory-wide, manager-editable run validation rules modeled on the allergen rule; web+mobile parity.
---

# Production Rules

Manager-editable, factory-wide validation rules applied to each run. Modeled on the
allergen sequence rule but generalized. Lives in shared lib `@workspace/production-rules`
(flat `ProductionRule`: id, name, type, enforcement, enabled + optional field/min/max/
attribute/before/after). Three rule types: `required-field`, `numeric-range`,
`sequence` (reuses `@workspace/allergen`).

**Enforcement model:** `flexible` = warn inline on the run/config screen; `strict` =
block the Start-run action. `evaluateRules(rules, ctx)` returns violations each tagged
with their rule's enforcement; clients split into flexible (warn) vs strict (block).

**Persistence:** server-side, factory-wide — NOT in the /sync day-state payload (it is
global config, not per-day run data). Table `production_rules`. Routes:
`GET /production-rules` (authed) / `POST` upsert / `DELETE` — **POST & DELETE are
manager-only** via `requireRole("manager")`; they're in `roles.integration.test.ts`
GATED_ROUTES. Client manager-gating is UX-only; the server is authoritative.

**Why:** managers need to enforce shop conventions (required fields, sane ranges,
allergen ordering) without code changes, and operators must not be able to mutate them.

## Web ↔ mobile field mapping (must stay identical)
The rule fields (`RULE_FIELDS`) are evaluated against per-run values. Mapping when
building the `fields` ctx:
- `targetDoughballWeight` → mobile `settings.doughballWeightOz` (web maps its equiv).
- `lineSpeed` → effective ppm: `crustsPerCycle>0 ? crustsPerCycle*cycleSpeed*speedAdjustment : lineSpeedPPM` (mobile); web uses `approxLineSpeed`.
- brand/flavor/casesNeeded/sauceOzPerPizza/dieType come straight from run settings.
Sequence rules pass `sequence` = all runs' allergen attribute + `currentRunId` so only
transitions involving the current run are flagged.

## Gotcha: numeric-range needs a seeded bound
`normalizeRule` rejects a numeric-range rule with neither min nor max, and the server
drops malformed rules. So `newRule("numeric-range")` MUST seed a bound (currently
`min:0`) or the manager UI's "Add rule" silently no-ops (it POSTs immediately, then the
manager edits the bounds). Found in code review. Tests live in
`artifacts/run-calculator/src/productionRules.test.ts` (libs hold no test files).
