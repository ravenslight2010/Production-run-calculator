---
name: Run-calc engine parity test
description: How the core production-run math is unit/parity tested across web and mobile, given web's engine isn't importable.
---

The calc-engine tests live in `artifacts/run-calculator/src/runCalc.parity.test.ts`
(node env, runs under the `test:client` validation).

Key constraint: web's `computeCalc` is **inline in a React `useMemo`** in
`pages/home.tsx` — it is NOT an importable function. So a literal "call both
computeCalc" parity guard is impossible. The test works around it:

- **Mobile side**: `computeCalc` (+ `sauceBarrelBreakdown`, `computeDoughSupply`,
  `liveFreezerMin`) is loaded from `run-calculator-mobile/context/RunContext.tsx`
  via the strip-imports → `typescript.transpileModule` → temp-`.mjs` pipeline
  (see web-test-harness.md). RunContext is a `.tsx` with JSX + a top-level
  `createContext(...)` and a top-level `INITIAL_STATE` that spreads
  `MIX_SEED.brands`/`.brandFlavors`/`.frontlineIngredients`, so the STUB_PRELUDE
  must define `createContext`, a `React` object, AND a `MIX_SEED` with those
  three fields, plus `jsx: ts.JsxEmit.React` in compilerOptions.
- **Web side of the parity guard**: use the importable shared `computeSummaryStats`
  (utils.ts), NOT the inline engine. It shares the exact per-pizza frontline
  formulas (oz/16 + buffer, ÷ effBatch, "mix"/default-pep exclusions, recipe-lbs
  override) but on a different pizza basis. Make the bases coincide by using
  `casesPerLayer:0` + unstarted + zero progress (→ casesOnLine 0 →
  casesLeftToRun = casesNeeded), then assert mobile.computeCalc == web summary.

Encoded-as-expectations (not surprises):
- `sauceBarrelBreakdown` signature: web takes BATCHES, mobile takes LBS; same
  physical scenario agrees, and passing LBS to the web helper visibly over-counts.
- Dough/timing intentionally use the casesLeft basis while frontline uses
  casesLeftToRun + a doubled layer buffer (see frontline-formula-parity.md).

**Why:** locks the documented web↔mobile parity subtleties so silent drift in the
core math is caught by the test suite.
