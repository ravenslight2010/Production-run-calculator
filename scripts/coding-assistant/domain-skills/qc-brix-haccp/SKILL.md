---
name: qc-brix-haccp
description: Use when working on QC checks, Brix testing, HACCP checklists, run-tied quality controls, or QC department workflows in the production assistant (v1 or v2).
---

# QC / Brix / HACCP Skill

## Purpose
Support quality-control features that are tied to production runs: Brix readings, HACCP checklists, station-level QC, and related reporting.

## When to use
- Adding or fixing Brix testing
- Building run-tied QC checklists
- HACCP compliance steps
- QC dashboards or reports
- Porting QC from v1 to the thinner v2 model

## Core rules
1. QC should be tied to a specific run (and preferably station) — avoid free-floating checks.
2. Keep the surface thin for pilot; do not re-implement the full v1 QC surface unless asked.
3. Brix and other numeric readings need units, expected ranges, and clear pass/fail.
4. Prefer server-authoritative confirmation over client-side only state.

## Workflow
1. Confirm the run / station context.
2. Locate existing QC models, tables, or stubs.
3. Propose the minimal data model and UI for the needed check.
4. Include validation (range, required fields, operator sign-off if relevant).
5. Suggest how results appear in the run history or dashboard.

## Output
- Suggested schema or type changes
- Example checklist structure
- Validation rules
- Migration or cutover notes if moving from v1
