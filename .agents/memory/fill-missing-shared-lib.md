---
name: Fill-missing shared lib
description: How the run-setup "fill in missing data" logic is shared across web + mobile via a workspace lib.
---

The pure "fill in missing data" detection/proposal logic lives in
`@workspace/fill-missing` (`lib/fill-missing/src/index.ts`): FIELD_SPECS,
DOCUMENTED_DEFAULTS, isBlankValue, detectMissingFields, buildProposals,
aiCandidates, buildFillMissingInput, and all related types. It has NO
platform imports (no fetch, no storage, no React Native).

Each app's `fillMissing.ts` (`artifacts/run-calculator/src/fillMissing.ts`,
`artifacts/run-calculator-mobile/context/fillMissing.ts`) does
`export * from "@workspace/fill-missing"` and adds ONLY its platform glue:
`requestFillMissing` (fetch + auth), `fillMissingErrorMessage`, and the
`makeWebLookup` / `makeMobileLookup` known-source resolvers. Consumer imports
(FillMissingPanel) stay pointed at the app module and are unchanged.

**Why:** the logic used to be two byte-identical copies kept in sync by hand,
and the parity test had to load the mobile copy through a
strip-imports→transpile→temp-mjs hack. One source of truth removes the drift
class and lets the test import the lib directly.

**How to apply:** add fill-missing FIELDS/logic in the lib only — never edit one
app's copy. To wire a new lib like this: package.json `exports` → `./src/index.ts`
(TS source, metro + vite bundle it fine), add to root `tsconfig.json` references
and each consuming app's tsconfig `references`, add `"@workspace/<name>":
"workspace:*"` dep, then `pnpm install`. This is the model for pulling other
hand-synced duplicates (e.g. inventory consumption math) into shared libs.
