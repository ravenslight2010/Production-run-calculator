---
name: inventory-math shared lib
description: Shared pure consumption/summary math extracted to @workspace/inventory-math; web+mobile keep only platform glue.
---

The per-run material totals + inventory consumption mapping (computeSummaryStats,
computeRunLines, computeRunConsumptionLines, deriveCandidateItems) live in
`lib/inventory-math` (mirrors `lib/fill-missing`). Web (`artifacts/run-calculator`)
and mobile (`artifacts/run-calculator-mobile`) each keep only thin wrappers + their
platform glue (REST/SSE clients, storage, auth) in their `inventoryShared.ts`.

**Why:** replit.md parity rule — the two apps deduct inventory against the SAME
backend keys and must compute identical quantities; duplicated math drifts.

**How to apply:**
- Change a formula ONCE in `lib/inventory-math/src/index.ts`; never re-add inline math to either app.
- `DEFAULT_PEP_TYPES` is deliberately NOT in the lib — it's injected as a param (each app owns its own copy, used widely as a seed list).
- Canonical doughball field name in the lib is `doughballWeightOz`. Mobile `RunSettings` already uses it (pass through). Web `FormValues` uses `targetDoughballWeight` → its wrapper maps `{...vals, doughballWeightOz: vals.targetDoughballWeight}`.
- Web `computeSummaryStats` wrapper stays in `src/utils.ts` (kept single-arg so ~20 call sites + the parity test importing from `./utils` are unchanged).
- Re-exporting the types: `export type { X } from "lib"` does NOT bring X into local scope. Since these files USE the types internally too, `import type { X }` them AND `export type { X };` separately.
