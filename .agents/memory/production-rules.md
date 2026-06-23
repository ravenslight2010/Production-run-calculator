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

## Exceptions: bypass conditions + required checklist
Any rule type can carry two optional exceptions (apply to all types incl. sequence):
- `bypass: RuleBypassCondition[]` ({field,value} over RULE_FIELDS keys). If the run
  matches ANY condition the rule is waived ENTIRELY — `evaluateRule` returns null, so
  no warning AND no block. Text match is case-insensitive; number match is numeric
  equality (`isRuleBypassed` exported for clients).
- `checklist: string[]` ordered steps. A violated strict rule still emits a violation,
  with the steps copied onto `RuleViolation.checklist`. Start unblocks only once the
  operator checks every step.

**Per-run ack is CLIENT-ONLY, never persisted/synced.** Both apps hold a local
`checklistAcks: Record<string,boolean>` keyed by `${runId}#${ruleId}#${stepIndex}` so
checks reset per run yet survive switching away and back. `blockingViolations` =
strict violations whose checklist isn't fully acked (a strict rule with NO checklist
always blocks, old behavior). Web key uses `currentRunId`; mobile uses `run.id`.
**Why local:** acks are a momentary per-operator gate, not shop policy — keeping them
out of the synced day-state avoids cross-device clobber and keeps the rule model pure.

Persistence: `bypass`/`checklist` are nullable JSONB columns on `production_rules`
(stored only when non-empty). `normalizeBypass`/`normalizeChecklist` drop malformed
entries (unknown field, blank value/step) and cap at 20 each.

## Gotcha: exception "Add" buttons must edit LOCAL state, not the server round-trip
`RuleExceptionsEditor` (web + mobile) must hold `bypass`/`checklist` in local
component state seeded once from the rule, and render from that — NOT re-derive them
from `rule.bypass`/`rule.checklist`. **Why:** every edit POSTs and the UI is replaced
from the mutation result (`qc.setQueryData`), but `normalizeBypass`/`normalizeChecklist`
strip empty entries on save. A newly-added empty placeholder row therefore vanished on
the round-trip → "Add bypass condition / Add checklist step do nothing." Persist both
lists together via one `commit(nextBypass, nextChecklist)` so editing one never ships a
stale copy of the other. Tradeoff (accepted): an already-open editor won't resync
concurrent external edits to the same rule's exceptions (manager-only, low concurrency).

## Gotcha: numeric-range needs a seeded bound
`normalizeRule` rejects a numeric-range rule with neither min nor max, and the server
drops malformed rules. So `newRule("numeric-range")` MUST seed a bound (currently
`min:0`) or the manager UI's "Add rule" silently no-ops (it POSTs immediately, then the
manager edits the bounds). Found in code review. Tests live in
`artifacts/run-calculator/src/productionRules.test.ts` (libs hold no test files).
