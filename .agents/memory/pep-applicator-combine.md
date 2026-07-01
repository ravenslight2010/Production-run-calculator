---
name: Pep applicator combine + B slot
description: The pep1Combined flag and per-applicator "B" extra pep type on web run-calculator, and the legacy-resolution gotcha across load paths.
---

# Pep applicators: combine flag + additional pep type (B slot)

WEB-ONLY feature (added while web+mobile parity was paused — see `.local/parity-pause-log.md`).

## What it does
- `pep1Combined` (bool, DEFAULT `true`): when true, applicator 1 runs both applicators — applicator 2 is hidden/suppressed (its lbs/batches forced to 0), applicator-1 label shows "1 & 2", and applicator 1's STICK buffer is DOUBLED (sticks only; oz/pizza unchanged).
- Each applicator carries one optional extra pep type in a "B" slot: `pep{1,2}TypeB/SticksB/OzPerPizzaB/BatchLbsB`, guarded by non-empty trimmed `typeB`. B consumption folds into the same inventory key as any same-named pep.

## Parity-safety (critical)
The shared lib `@workspace/inventory-math` is used by BOTH web and mobile. It uses STRICT `pep1Combined === true` and treats all B fields as optional. Mobile never sets these fields, so mobile behavior is unchanged. A web-created run that syncs to mobile may legitimately carry combined/B math — accepted.

## The load-path gotcha (why this took a review pass)
`DEFAULT_VALUES.pep1Combined = true`, so a blind `{...DEFAULT_VALUES, ...rawRun}` merge WRONGLY combines a *legacy* run that already used two pep types. Fix = `resolvePep1Combined(result, rawHadFlag)` in storage.ts: if the raw record had no explicit flag, infer it (a run with a non-empty `pep2Type` is NOT combined; a single-pep run IS).

**Rule:** EVERY path that surfaces a stored/remote run value through a DEFAULT merge must call `resolvePep1Combined` with `rawHadFlag = typeof raw.pep1Combined === "boolean"`, computed from the RAW record before the merge. This includes `loadProfile`, `loadRunValues`, `loadHistory`, AND the live-sync form-reset path in home.tsx (direct `{...DEFAULT_VALUES, ...payload.runValues[currentId]}`). Paths that read via `loadRunValues` are already covered (it normalizes on read). If you add a new load/merge path, add the resolver or legacy 2-pep runs silently double their pep sticks.

**Why:** display, consumption, exports, and forecast all read the same values; an unresolved legacy run shows wrong pep totals and a wrong "1 & 2" label.
