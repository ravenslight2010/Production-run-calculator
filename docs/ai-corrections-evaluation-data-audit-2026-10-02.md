# AI Corrections and Evaluation Data Audit

**Date:** 2026-10-02  
**Scope:** Reviewed spec-sheet, cheese, premix, and Excel schedule-matching confirmations; shared correction writes; checked-in evaluation evidence.

## Summary

Confirmed mappings are written to the import-specific alias store and, where the mapping has an explicit shared-memory domain, mirrored to `/api/ai-corrections`. Suggestions alone do not create memories. Shared-memory and specialized-alias writes are advisory: a failure now produces a warning and safe diagnostic while leaving the reviewed import or match applied.

Spec aliases now use an explicit shared-domain map. `dieType` maps to `die`; `crossFamilyRouting` remains a specialized routing hint and is not a name correction. Unknown alias kinds are not treated as ingredients.

The repository has deterministic parser regression evidence and a historical discrepancy-review benchmark, but no independently verified, field-level extraction gold set suitable for comparing providers or training a model.

## Route-to-correction map

| Reviewed flow | What is persisted after confirmation | Shared correction mapping | Failure behavior |
| --- | --- | --- | --- |
| Spec-sheet review and commit (`specImport.ts`) | Sanitized, reviewed aliases are sent to `/api/spec-import-aliases`. This covers supported brand, flavor, applicator/pepperoni type, named-recipe, ingredient, and die aliases. | `brand` → `brand`; `flavor` → `flavor`; `appType`, `pepType`, `recipeName` → `item`; cheese/dough/sauce ingredient kinds → `ingredient`; `dieType` → `die`. `crossFamilyRouting` is excluded. | A specialized-alias failure sets `aliasSaveFailed`, records a partial import-history result, and shows a warning without undoing the applied import. Shared-memory HTTP or network failures show a separate warning and do not reject the commit. |
| Cheese import review (`cheeseImport.ts`) | Confirmed aliases are saved through `/api/spec-import-aliases`, including reverse corrections when a reviewed mapping replaces a stale redirect. | Only the supported `brand`, `flavor`, and `appType` aliases are mirrored as `brand`, `flavor`, and `item`. | The committed cheese recipes remain applied. A failed specialized-alias write is returned as a warning and shown after commit; shared-memory failure is independently warned. |
| Premix import review (`premixImport.ts`) | Confirmed brand/flavor or “use existing” choices are saved through `/api/spec-import-aliases`, with the same stale-redirect correction behavior. AI matching itself only proposes candidates. | Only `brand`, `flavor`, and `appType` are mirrored as `brand`, `flavor`, and `item`. Mix names are not mislabeled as flavor corrections, and component data is not promoted to a correction unless the review produced a supported alias. | The committed mixes remain applied. Alias failures are returned as a warning and shown after commit; shared-memory failure is independently warned. |
| Excel schedule import matching (`ExcelImportDialog.tsx`) | Final user-selected brand/flavor mappings are collected only when the user confirms and sent to `/api/import-aliases`. | Brand and flavor mappings are mirrored to their corresponding shared domains. | The schedule import continues. Specialized-alias and shared-memory failures each produce a warning; diagnostics contain only a fixed store/failure label, capped count, and valid HTTP status when available. |
| AI match suggestions | `/ai/match-import` and `/ai/match-premix` return suggestions for review. | None until the user confirms a mapping through one of the flows above. | Provider failure leaves deterministic matching and manual review available; it does not silently authorize a correction. |

### Authorization boundary and unresolved owner decision

Writes to `/api/spec-import-aliases` and `/api/import-aliases` require `manage-profiles`. `POST` and `DELETE /api/ai-corrections` require `manage-staff`; reads require `use-ai-tools`. The repository does not establish that every person allowed to confirm an import mapping has both write capabilities. A `manage-profiles` user without `manage-staff` can therefore apply the import and save its specialized alias while the shared-memory mirror receives a 403.

This audit leaves those permissions unchanged. The UI reports the failed shared write and deterministic work continues. A data owner should confirm whether the shared correction writer should include all `manage-profiles` users before changing the authorization rule.

### Safe failure reporting

Client diagnostics use an allowlisted store and failure category, a correction count capped at 1,000, and an HTTP status only when it is a valid status code. They do not include correction values, request bodies, workbook data, or provider output. The shared-correction and specialized-alias API routes log validated machine-readable error metadata rather than raw database error objects, which can contain SQL text and bound parameters.

## Evaluation-data inventory

### Deterministic 51-workbook corpus

`lib/corpus-harness/snapshots/evaluation-manifest.json` describes evaluation `deterministic-import-corpus`:

- Manifest version: `1`; outcome: `passed`.
- 51 retained workbook cases; source authority: `retained-source-workbooks`.
- Source SHA-256: `5a57be7a35fd75b1bcfd42cf59fab51dd6749f4e5cc942e483ebe3ba8f8c8b49`.
- Evidence SHA-256: `59058925624310ec1df7eb18b92a329951b54a333c5ae93c4f14e89fa7198e77`; evidence type: `source-workbook-byte-hash`.
- Evaluator SHA-256: `749ccb3f87a98d13348a799f477026eb42289aebf174691b396101a98b97cfee`.
- Runtime/dependency identity: Node `24.20.0`, the current workspace lockfile SHA-256 `006622ea6139467c2ba7fee60e8fc4b468cb483659cd6896a116a69975a81341`, declared XLSX dependency `npm:@e965/xlsx@^0.20.3`, and Vitest `5.0.0`.
- Thresholds: at least 51 files, zero dropped prompt rows outside schedules, and zero grid-sanity issues.
- Privacy: metadata-only; no evaluation content or raw provider payloads retained. Provider identity is not applicable. Token counts and p95 latency are unavailable for this deterministic test; measured provider cost is zero.

The manifest had a stale lockfile digest and an outdated hard-coded Vitest version. The digest now matches the current lockfile, and the harness reads XLSX and Vitest versions from its package manifest so future dependency changes are reflected. The deterministic importer outputs in the other corpus snapshots are regression expectations, not independent gold labels for AI extraction. `SPEC_PARSE_VERSION` remains `40`; this audit changes correction mirroring and evaluation metadata, not model prompts or parser output.

### Historical second-pass reviewer benchmark

`docs/second-pass-reviewer-benchmark-2026-09-05.md` and its JSON manifest describe 304 labeled cases from deterministic reconciliation and mandatory human review:

- 101 material discrepancies were already surfaced by deterministic reconciliation.
- 203 unresolved non-material records remained for human review.
- The historical Gemini `gemini-2.5-flash` reviewer produced zero unique material catches, three duplicate warnings, 301 no-op verdicts, and unusable JSON in 301 of 304 cases.
- The measured p95 latency was 24,169 ms. Token counts and cost were unavailable; false-warning rate could not be measured for the failed batches.
- The report is metadata-only, retains no raw provider payloads or evaluation content, and is source-hash bound. Its evaluator identity is unavailable.

This is evidence about discrepancy detection by one historical reviewer run. It is not a field-level extraction benchmark, a provider comparison, or evidence that model output is correct. The report's failed outcome and unavailable measurements must remain visible if it is reused.

## Gold outcomes: what exists and what is missing

The deterministic corpus can verify that deterministic parser layers continue to behave as captured. The reviewer benchmark has aggregate labels for discrepancy detection. Neither supplies independently adjudicated expected values for each field extracted from each source workbook, so neither is valid gold data for comparing extraction providers or training a model.

No such field-level gold set was identified in the checked-in artifacts examined for this audit. Before creating one:

1. Use a versioned, access-controlled source inventory. Record opaque case IDs, source authority, workbook SHA-256, evaluator/prompt/schema versions, dependency lock identity, and stable source locations in restricted evidence. Do not copy workbook cells or rows into ordinary repository documentation.
2. Have a qualified reviewer label expected fields against the retained source, independently of model predictions and parser snapshots. Record reviewer method, verification state, disagreements, and adjudication; keep unverified or ambiguous fields out of the gold split.
3. Bind every provider run to the same corpus version and split, plus provider/model identity, prompt/parser version, retry policy, status, and measured token, cost, and latency fields. Mark unavailable measurements as unavailable rather than estimating them.
4. Split by source workbook or customer grouping to prevent related rows from leaking between development and held-out evaluation. Keep raw source, prompts, and model responses in an approved restricted location; commit only approved synthetic fixtures and metadata/hashes.
5. Keep operational records and source payloads out of application logs. At write failures, log only allowlisted outcome metadata and bounded counts.

## Verification performed for this audit

- Focused web correction/mapping/import tests: 5 files, 30 tests passed.
- API error-boundary test: 12 tests passed, including removal of non-machine-readable metadata.
- Deterministic corpus harness: 12 tests passed against the corrected lockfile, dependency, and evaluator hashes.
- Full workspace typecheck: passed against the final change set.
- API server workflow restarted successfully and reported ready; `git diff --check` passed.
- No raw workbook, prompt, provider response, or operational record was added to the audit document, manifest, or tests.
- No live provider benchmark, local-model benchmark, model training, permission broadening, or data heal was performed.