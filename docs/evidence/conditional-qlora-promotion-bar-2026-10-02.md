# Conditional QLoRA candidate promotion bar — frozen before holdout

- **Decision date:** 2026-10-02
- **Policy status:** Owner-approved promotion thresholds; protocol rules frozen, run identities pending
- **Execution status:** No-go to train or evaluate; prerequisites are not met
- **Repository revision reviewed before this supplement:** `2e74239fb8dad788bd8ab63c5a9b05f6b89bd8e9`
- **Privacy:** Metadata only. No workbook content, examples, prompts, or provider payloads are retained here.

This supplement updates only the earlier statement that the gain threshold was not yet established. It does not supersede the training no-go or any outstanding prerequisite in the original decision.

## Decision

A trained candidate is eligible for a promotion recommendation only if it shows a statistically supported, material gain over the frozen, well-prompted base model on **both** field-agreement measures:

| Measure | Required gain over prompted base |
| --- | ---: |
| Overall field agreement (primary) | **At least +5 percentage points** |
| Critical-field agreement | **At least +3 percentage points** |

The owner approved these margins on 2026-10-02. They are absolute percentage-point differences, not relative percentage changes. The two required gains prevent an aggregate improvement from hiding a lack of improvement on risk-sensitive fields. Both margins must be cleared; neither can compensate for failing the other.

This decision sets a future promotion bar only. It does not authorize training, opening the holdout, changing production routing, or relaxing import review.

## Comparison and scoring protocol

1. **Use one untouched, never-look holdout.** Compare the trained candidate, its frozen prompted base, and Gemini on the exact same independently verified cases and frozen case-specific inputs. Do not use deterministic parser snapshots or discrepancy-review labels as gold.
2. **Freeze all evaluation identities before opening the holdout.** Record the source revision, prompt and parse/cache identity, output-schema and sanitizer identity, case/input manifest digest, gold-label manifest digest, field-scoring rules, candidate and base model/tokenizer digests, generation settings, Gemini model/settings, retry policy, and scoring implementation digest. Keep payloads and source data in the approved access-controlled store; retained evidence is allowlisted metadata and hashes only.
3. **Score paired field agreement.** A field is correct only when it matches its independently verified gold value under the frozen normalization rules; missing required values are incorrect. For each case, calculate the fraction of eligible fields that are correct, then macro-average case scores so a large workbook cannot dominate. Calculate critical-field agreement the same way using the predeclared critical-field list. Compare candidate-minus-base case scores; report candidate, base, and Gemini results on the same cases.
4. **Account for brand clustering.** Estimate one-sided 95% lower confidence bounds for the paired overall and critical-field gains using a predeclared cluster bootstrap that resamples whole brands, not individual fields. Pin the bootstrap implementation and random seed in the run manifest. Both lower bounds must be strictly greater than their respective approved margins.
5. **Establish sample sufficiency without holdout results.** Before unsealing the holdout, use development-only estimates in an a priori paired, brand-clustered power analysis. Require at least 80% power to detect both approved margins at the stated confidence level with the planned number of independent brand groups. Record the calculation and required sample size before accessing holdout outcomes. If the available verified holdout cannot meet this requirement, do not open it for scoring; obtain more independently verified, appropriately separated cases or leave the result inconclusive.

### Offline power preflight method

The project-owned `calculateQloraPromotionPower` preflight accepts paired candidate and prompted-base case results only when the input is explicitly scoped as development-only. It validates exact case pairing, brand identity, and field sets, then hashes a canonical representation of the paired correctness evidence. It makes no provider calls and returns metadata only; case rows, case IDs, brand IDs, and field correctness are not included in the result.

The frozen method identifier is `seeded-empirical-brand-cluster-simulation-normal-bound-v1`. It resamples complete development brand clusters with replacement, uses a one-sided 95% cluster-normal lower bound for each simulated sample, and requires the 95% Wilson lower bound of the Monte Carlo power estimate to reach 80% for both margins. It uses 5,000 simulations per planned size and searches for the smallest qualifying count, up to a bounded maximum of 1,000 brands. The development-evidence hash, seed, method, targets, sample counts, and resulting powers are retained in the returned metadata. If the input is missing, malformed, not explicitly development-only, or cannot establish both targets within the bound, the result is unavailable or insufficient and cannot qualify the promotion evaluator.

This power-analysis method is separate from the seeded brand-cluster percentile bootstrap used for final holdout confidence bounds. Passing the preflight does not establish a promotion result or authorize opening the holdout.

### Synthetic reference check

The preflight’s reported minimum brand count and both powers are checked against an independent offline C++17 Monte Carlo reference, using `std::mt19937_64` seeded with `20261002 + total synthetic cases` and 1,000,000 draws per synthetic vector. The reference draws whole brands with replacement and computes the case-weighted mean and cluster-normal lower bound directly from each brand’s case and gain totals; it does not call the TypeScript preflight or share its seeded random generator. The reference minimum is the first count whose estimated power, projected to 5,000 trials, has a 95% Wilson lower bound of at least 80% for both measures.

Each vector uses 100 synthetic eligible fields, 20 of them critical. Candidate-only correct fields encode the paired gains; there are no customer records or provider calls. The predeclared comparison tolerances are an absolute power difference of at most 0.03 for each measure and the per-vector brand-count tolerance below.

| Synthetic profile | Brands / cases | Mean overall / critical gain | Reference minimum (count tolerance) | Reference overall / critical power at minimum |
| --- | ---: | ---: | ---: | ---: |
| Balanced, low variance, comfortably above margins | 16 / 160 | 8.00 / 4.50 pp | 2 (±0) | 1.000000 / 1.000000 |
| Uneven, low variance, near margins | 16 / 240 | 6.00 / 3.48 pp | 4 (±1) | 0.818911 / 0.948178 |
| Balanced, high variance, near margins | 20 / 200 | 6.50 / 3.50 pp | 99 (±3) | 0.940603 / 0.814192 |
| Uneven, high variance, near margins | 20 / 250 | 6.30 / 3.60 pp | 10 (±1) | 0.828271 / 0.999996 |

The TypeScript preflight is also checked against these independent curves for the three near-margin profiles at additional predeclared seeds `20261003`, `20261004`, and `20261005` (the existing baseline seed is `20261002`). Before running those checks, the accepted limits remain the per-profile minimum-count tolerances above (±1 for uneven low variance, ±3 for balanced high variance, and ±1 for uneven high variance) and an absolute power difference of at most 0.03 for each measure at the returned count. These are synthetic 5,000-replicate runs and make no provider calls.

These vectors check estimation behavior only. They do not provide development evidence, establish a real sample-size requirement, or change the holdout restriction.

## Decision rules

- **Promotion recommendation:** Both paired lower confidence bounds are strictly above +5 and +3 percentage points, respectively, and every safety gate below passes. This is a recommendation for review, not an automatic production change.
- **No-go:** Any non-compensatory safety gate fails, or a gain's upper confidence bound is at or below its required margin. The evidence then rules out the minimum required gain for at least one measure.
- **Inconclusive; no promotion:** The sample-size/power prerequisite is unmet, a confidence interval crosses a required margin, the estimate ties or falls short without ruling out the margin, or evaluation identities/comparators are not validly matched. A point estimate equal to a threshold does not pass.

## Non-compensatory safety gates

The candidate must also pass the existing Phase-0 gates against Gemini on the same holdout:

- Schema-valid rate is at least Gemini minus 1 percentage point **or** at least 99% absolute.
- Critical-field agreement is at least Gemini minus 3 percentage points. A gap greater than 5 percentage points is a hard fail.
- Overall field agreement is at least Gemini minus 5 percentage points.
- Blank-poison cases: **zero**; any occurrence is a hard fail.
- Empty-output rate is no more than Gemini plus 1 percentage point.
- Systematic missing required fields are a hard fail.

These gates are independent of the gain margins. A candidate cannot trade a blank-poison event, critical-field failure, or other safety failure for better overall accuracy.

## Current blockers and holdout state

The evidence available for the 2026-10-02 decision records zero independently verified spec-import gold cases, no approved local inference endpoint/model identity, no verified training manifest, and insufficient approved compute. Therefore:

- No training or model evaluation is authorized by this record.
- The never-look holdout has not been opened and must remain untouched until verified-data, endpoint, compute, and evaluation-identity prerequisites are satisfied.
- The preflight calculation method is available, but no sample-size or power result is claimed until valid paired development-only evidence is available and evaluated.
- Production routing and import review remain unchanged.

## Related evidence

- `docs/evidence/conditional-qlora-training-decision-2026-10-02.md` — current training no-go and prerequisite assessment.
- `docs/evidence/local-spec-import-benchmark-blocker-2026-10-02.md` — Phase-0 comparison definitions and current benchmark blocker.
- `docs/evidence/distillation-dataset-safety-review-2026-10-02.md` — data provenance and privacy gates.