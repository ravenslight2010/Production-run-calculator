---
name: Mix reconcile + assistant
description: Advisory-AI Mixes monitoring (new/drifted detection) + chat assistant; deterministic client diff, AI narrates only.
---

Advisory-AI in the Mixes section of BOTH apps, strict web+mobile parity.

## Two features
- **Mix monitoring**: detect products that need a NEW mix and existing mixes that DRIFTED, by diffing CURRENT mixes against two import sources the user already saved:
  - a saved **premix sheet** snapshot (Mix-vs-Mix → can flag a brand-new mix), and
  - a saved **spec sheet** (drift only — a mix is a subset of the full recipe, so no missing-mix/missing-component, only amount-mismatch + extra-component).
- **Mixes chat assistant**: staff-facing single-shot Q&A grounded in current mixes. Advisory answer + optional note, **NO structured apply** (deliberate scoping decision).

## Why deterministic-diff-on-client + AI-narrates-only
The new/drifted decision is pure math, so it lives in `@workspace/mix-reconcile` and runs CLIENT-side (instant, free, identical web+mobile). `/ai/mix-reconcile` only NARRATES the already-computed discrepancies and is **fail-safe**: `narrate()` returns "" on any error/missing base URL/non-OK, and the deterministic list always renders. `/ai/mix-assistant` is advisory and never writes.

## Apply path (the only write)
`applyMixReconcileItem` upserts `item.suggestedMix` into the current list **by id** (replace if present, else append) then persists through the **manager-gated `saveMixes`** path; UI invalidates `["mixes"]`. The "Apply suggested fix" button is rendered only when `isManager`. Server enforces manage-inventory on `/mixes` writes regardless.

## Wire-payload gotcha
`toWire()` strips undefined optional fields (`ingredient`, `sheetPerPizza`, `mixPerPizza`) from each discrepancy before POST, or the codegen Zod body rejects/bloats. Keep web and mobile `toWire` identical.

## Premix snapshot source
The snapshot is saved by `commitPremixImport` (web + mobile) AFTER the real `saveMixes`, best-effort in try/catch — it's monitoring data, never block the import on it. Server keeps only the 2 most recent (`MAX_SAVED=2`), mirroring saved spec sheets.

## Platform glue difference (the only intended diff)
Web `src/{savedPremixSheets,mixReconcile,mixAssist}.ts` use the cookie jar; mobile `context/*` thread bearer token + client id via fetch (no cookie) and resolve the API base URL — same as `context/mixes.ts`/`savedSpecSheets.ts`. UI logic is mirrored verbatim (web `src/components/Mix*.tsx` ↔ mobile `components/Mix*.tsx`).

**Note:** saved premix/spec-sheet POST/DELETE routes are requireAuth but not capability-gated server-side — this mirrors the pre-existing saved-spec-sheets behavior (monitoring snapshots, not core mix writes). Core mix writes ARE manager-gated.
