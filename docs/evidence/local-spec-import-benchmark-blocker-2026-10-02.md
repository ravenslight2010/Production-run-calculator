# Local spec-import model benchmark — blocked

**Evaluation date:** 2026-10-02  
**Status:** Not run; decision is **inconclusive**  
**Source revision:** `7f41f4931c459a3f273af7554d5527503d1d98f9`  
**Privacy:** Metadata only. No retained workbook contents or provider payloads are included.

## Decision

There is not enough safe, independently verified evaluation data to compare providers, and no approved local inference endpoint or model is configured. Do not switch providers or promote a local candidate based on this evidence. Leave the existing Gemini route unchanged while those blockers are addressed.

This is an **inconclusive** result, not a measured finding that Gemini is better.

## Frozen evaluation identity

| Item | Pinned identity |
| --- | --- |
| Spec parse/cache version | `SPEC_PARSE_VERSION` `41` |
| Production system-prompt SHA-256 | `65196b19789f6f1cc676c45f00e32b14c34320f869766e8f6c711a351e9f9d76` |
| Output contract | `ParsedSpecImport` (profiles, recipes, optional note, warnings, and unresolved rows), interpreted through the current sanitizer at the source revision above. The code does not declare a separate output-schema version. |
| Retained-workbook corpus | SHA-256 `5a57be7a35fd75b1bcfd42cf59fab51dd6749f4e5cc942e483ebe3ba8f8c8b49`; 51 source workbooks |
| Eligible comparison cases | 0 |

The prompt digest is for the generated production **system** prompt; it does not identify a workbook-specific user prompt. There are no eligible frozen user prompts because there are no verified gold cases.

## Case eligibility and gold outcomes

| Case group | Count | Gold status | Benchmark use |
| --- | ---: | --- | --- |
| Spec workbooks in the retained corpus | 19 | No independently verified field-level outcomes identified | Unlabelled; unsuitable for provider-quality scoring |
| Other workbook types in the retained corpus | 32 | No extraction gold for spec-import | Not applicable to this benchmark |
| Verified spec-import gold cases | 0 | None | No eligible cases |
| Historical discrepancy-review cases | 304 | Labels measure discrepancy detection, not extracted-field correctness | Excluded |

The existing deterministic parser snapshots are regression expectations, not independent AI extraction gold. The retained corpus contains real customer data and was not sent to a provider.

For a future spec-import comparison, critical fields should include profile identity (`brand`, `flavor`); allergen and case-pack values; die, dough/crust, doughball, and tray fields; sauce identity and per-pizza quantity; applicator and pepperoni identities and weights; and recipe kind/name, ingredient rows, units, and profile targets. Field agreement must compare against independently verified source labels, not the deterministic snapshots.

## Provider settings and run status

| Provider | Pinned setting | Run status |
| --- | --- | --- |
| Gemini baseline | Current route selects `gemini-2.5-flash` via `pickModel("full")`, requests `json_object`, and allows `65,536` completion tokens. No benchmark request was made. | Not run |
| Local candidate | No approved endpoint or model identity is configured in the active workspace. | Not run |

No comparison cases, provider retries, sampling settings, or per-case user prompts were executed or frozen. A separate rule-regression smoke used a generated workbook and the existing Gemini integration only; it is not a baseline and contributes no benchmark measurements.

## Measurements

No eligible cases or comparison outputs exist. These are **unmeasured**, not zero:

| Metric | Gemini | Local candidate |
| --- | --- | --- |
| Schema-valid rate | Unavailable — not run | Unavailable — not run |
| Field-level agreement | Unavailable — no verified gold | Unavailable — no verified gold |
| Critical-field agreement | Unavailable — no verified gold | Unavailable — no verified gold |
| Blank-poison failures | Unavailable — no comparison outputs | Unavailable — no comparison outputs |
| Empty-output failures | Unavailable — no comparison outputs | Unavailable — no comparison outputs |
| Latency p50 | Unavailable — not measured | Unavailable — not measured |
| Latency p95 | Unavailable — not measured | Unavailable — not measured |

## Pre-run acceptance gates

These are the starting thresholds in the supplied Phase-0 design, not claims that either provider passes. They must be applied to the same verified cases and frozen settings before a future provider run:

| Gate | Local candidate must meet |
| --- | --- |
| Schema validity | At least Gemini minus 1 percentage point, or at least 99% absolute |
| Critical-field agreement | At least Gemini minus 3 percentage points |
| Overall field agreement | At least Gemini minus 5 percentage points |
| Blank-poison | Zero cases; any occurrence is a hard fail |
| Empty-output rate | No more than Gemini plus 1 percentage point |
| p95 latency | Report for comparison; informational in Phase 0 |

Any blank-poison case, a critical-field gap over 5 percentage points, or systematic missing required fields aborts local promotion.

## Prompt defect and validation

The production prompt contained an extra unary-plus operator that coerced the following instruction string to the literal text `NaN`. The operator was removed, the parse/cache version advanced from `40` to `41`, and a focused regression assertion now verifies that the generated production system prompt contains no `NaN` and retains the intended dough/crust instruction.

The deterministic corpus manifest is not prompt-bound: it records source-workbook hashes and deterministic evaluation output. Its snapshots were therefore not regenerated for this prompt-only correction. This blocker report records the corrected prompt digest instead.

Validation performed:

- `pnpm --filter @workspace/corpus-harness run test`: passed, 12 tests.
- `pnpm --filter @workspace/spec-import exec vitest run`: passed, 319 tests.
- `pnpm --filter @workspace/api-server exec vitest run src/routes/aiParseSpecSheet.test.ts`: passed, 47 tests.
- `pnpm run typecheck`: passed.
- Prompt-rule/round-trip smoke: passed against the current Gemini integration using a generated test workbook; two requests, no retained corpus workbook. Temporary generated outputs were removed.
- Large-size API smoke: not run because no isolated manager test account/database was established; the harness may create persistent authentication state when credentials are absent.
- API workflow restart: server reached port `8080` and startup-ready state. This does not establish production health.

## Limitations and next evidence needed

- No independently adjudicated field-level gold labels were available; deterministic snapshots and discrepancy-review labels cannot substitute for them.
- No approved local inference endpoint or local model identity was available.
- Gemini and local provider accuracy, blank-poison rate, empty-output rate, and p50/p95 latency remain unknown.
- A future comparison needs an access-controlled, verified gold split; frozen case-specific prompts; an approved local endpoint; fixed provider/retry settings; and metadata-only side-by-side manifests.

## Independent gold-case review protocol and current count

- **Protocol review date:** 2026-10-08
- **Review scope:** Repository evidence and metadata only. No customer workbook, personal or operational data, private evidence store, or provider payload was accessed.
- **Eligible independent gold cases found in the reviewed workspace:** 0
- **Authorized Apply-evidence bundle:** Not found in the reviewed workspace
- **Eligible cases in unreviewed private stores:** Unknown; those stores were not accessed.

This is a metadata-only preparation record, not a new benchmark result or a change to the inconclusive benchmark / no-go decision. The count is limited to eligible cases identifiable from the reviewed repository evidence; it does not claim that no cases exist in other stores. The 304 historical discrepancy-review cases remain excluded because their labels concern discrepancy detection, not source-backed extraction correctness.

### Authorization and privacy requirements

Before a reviewer opens source material, the data owner must authorize its use for spec-import accuracy evaluation, identify the permitted source records and reviewers, and confirm that the use is compatible with applicable customer terms and retention rules. Existing workbook access, a prior import, or a human Apply record is not by itself authorization for evaluation. If authorization or the allowed scope is unclear, do not inspect or use the material.

Keep source workbooks, extracted labels, source locations, and any identity mapping in an access-controlled location outside Git and general-purpose reports. Use opaque case IDs in review records. Do not include workbook names, customer or brand names, personal data, operational values, source rows, prompts, or provider outputs in public/shared evidence. A digest is an integrity aid, not anonymization; retain any source digest or detailed provenance only in the restricted record when authorized and necessary.

### Eligibility and independent labeling criteria

A case may count as an eligible independent gold case only when all of the following are true:

1. Its source is an authorized spec workbook, or an authorized human Apply record that can be independently checked against its underlying source evidence. Apply-only assertions without source support do not qualify.
2. The expected values are transcribed from the authoritative source, not copied from parser output, deterministic parser snapshots, prior discrepancy labels, or provider responses. Preserve raw source wording and units in the restricted record when normalization is needed.
3. Two reviewers independently label the case from the source without seeing parser/provider output or each other's labels. Review covers the applicable critical fields listed above, including explicit “not present”, “unclear”, and “not inferable” states rather than guessed values.
4. A separate adjudicator resolves disagreements against the source. Unresolved fields remain unknown; a case is not eligible for fields whose source cannot be interpreted reliably.
5. The restricted record binds the opaque case ID and labels to source evidence and records authorization, reviewer/adjudicator identities, review status, field coverage, and the applicable parse/prompt identity. Identity mappings and source locators remain restricted.
6. A privacy review confirms the retained evaluation metadata is minimized and does not expose source content or identifying details.

### Representative selection and future evidence

Select authorized cases before looking at any model output. Track broad source-layout and product/field-family coverage in the restricted review record so selection is not dominated by one template or category; do not publish customer or brand breakdowns. Record the number screened, number authorized for review, number fully adjudicated, and number eligible, using aggregate counts only. The case count is the unit of eligibility; field-level coverage and unknowns must be reported separately in a future evaluation.

No cases, labels, manifests, training examples, or dataset splits were created by this review. A future evaluation requires a separate decision using the then-current parse/prompt identity, an approved provider/model configuration, frozen settings, and its own privacy-safe evidence. This protocol does not authorize a provider run, training, or a change to the existing no-go. The benchmark remains unrun.

## Local model approval update — 2026-10-07

The project owner accepted an evaluation-only recommendation: Ollama serving Qwen3 8B instruct under model tag `qwen3:8b`. The intended endpoint is loopback-only at `http://127.0.0.1:11434/v1` on a dedicated evaluator-controlled host. The project owner is accountable for endpoint setup and operation; any separate operator must be explicitly designated and recorded in restricted run evidence. The selection follows the project's earlier local-AI installation research and is not a measured quality result.

Approved safeguards are: no customer or operational content until source-backed cases are separately authorized; no persistence or logging of raw prompts or responses; restricted evaluator access; one concurrent request; a 32,768-token context cap; a 120-second request deadline; and verified host-level CPU, memory, and accelerator limits on a dedicated non-production host. Retain only privacy-reviewed aggregate metrics and non-sensitive run metadata.

This selects the model for a possible comparison; it does not approve a provider call or production routing change. No endpoint host/service, model digest, or actual resource enforcement is verified in this evidence; these remain pre-run checks. The benchmark remains blocked until those checks, the independent source-backed case review, and separate Phase-0 run authorization are complete.