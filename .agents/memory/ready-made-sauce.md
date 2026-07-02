---
name: Bought/ready-made sauce pull-as-is
description: Runs with a sauce NAME but no mixed sauce recipe (BBQ, Ranch) are pulled/consumed by name in LBS from the spec sheet, not generic "Sauce" batches.
---

# Bought/ready-made sauces are pulled as-is by name

**Rule:** in `@workspace/inventory-math` `computeRunLines` (and web's mirrored
`aggregateNeedRows`), a run whose `frontlineRecipeName` is set but whose
`frontlineRecipe` has NO rows with lbs > 0 — AND `sauceOzPerPizza > 0` — consumes
`ingredient:<name>:lbs` with qty = `sauceLbs` (spec oz/pizza formula, incl. the
flat +30 lbs buffer). Any run with real recipe rows (or no name) keeps the legacy
`ingredient:Sauce:batches`.

**Why:** sauces like BBQ and Ranch are purchased ready-made — the factory never
mixes them, so a "Sauce batches" line is meaningless; staff need the actual sauce
name and pounds to pull. The `sauceOzPerPizza > 0` guard exists because `sauceLbs`
always includes a flat +30 buffer, which would otherwise charge 30 lbs of a sauce
that isn't used at all.

**How to apply:**
- Spec import feeds this: the AI parse prompt extracts a NAMED sauce from the
  sheet's sauce row into `SpecImportProfile.sauceName` (optional, additive in the
  OpenAPI contract; sanitized in `@workspace/spec-import`); web `applySpecImport`
  copies it to `values.frontlineRecipeName` only when the profile has no mixed
  recipe rows and no name already set. A sauce-recipe tie in the same import
  overwrites it (correct — a real recipe wins).
- Consumption keys must stay identical web+mobile (consume idempotency): the
  branch lives in the SHARED lib and mobile's RunSettings already carries
  `frontlineRecipeName`, so both apps compute the same key automatically. Only
  mobile's needs-rollup UI label + import glue were deferred (parity paused).
- Existing profiles do NOT retroactively gain a name — the spec sheet must be
  re-imported (or the name set manually) for the new behavior to kick in.
- **Visibility matters:** an applied sauceName that is shown nowhere reads as
  "didn't import" to the user. Web now (a) shows it in the import review
  summary line (`Sauce 4.5 oz (BBQ Sauce)`) and (b) registers it as a Sauce
  Recipe dropdown option in `applySpecImport`. Gotcha: the `newSauceNames`
  option-list flush runs BEFORE the profile loop — profile sauce names need
  their own post-loop merge (`profileSauceNames`), a push into `newSauceNames`
  inside the profile loop is silently a no-op.
