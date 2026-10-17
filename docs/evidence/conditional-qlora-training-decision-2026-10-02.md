# Conditional QLoRA training decision — no-go

**Decision date:** 2026-10-02

**Repository revision reviewed:** `7fc4e0db5b3b3934e960ee4e480d77e88ab15500`

**Review environment:** Replit development workspace; review date 2026-10-02. Exact wall-clock time was not retained.

**Privacy:** Metadata only. No workbook content, training examples, prompts, or provider payloads are retained in this report.

The review used the evidence files listed below, a read-only inventory of project files, and local checks for GPU visibility, Ollama availability, and local-endpoint configuration. No production database or external restricted dataset was accessed. The prior benchmark evidence separately records a short Gemini smoke using a generated test workbook; it is not benchmark evidence.

## Decision

Do not run QLoRA training or create training data or weights from the evidence available in this workspace. The prerequisite local-model comparison was not run, there are zero eligible independently verified spec-import benchmark cases, no approved local endpoint/model is configured, and no verified training examples or private dataset manifest are available here. The current host also has no visible GPU.

This is a **no-go because the evidence and execution prerequisites are absent**. It is not a measured result that Gemini is better, does not rule out future training, and does not change production routing.

## Gate assessment

| Gate | Evidence | Result |
| --- | --- | --- |
| Persistent, material local-base quality gap | The October 2 Phase-0 blocker records zero eligible comparison cases. Gemini and local quality, blank-poison, empty-output, and latency metrics were not measured. No approved local endpoint or model identity is configured. | **Not established.** No QLoRA trigger. |
| Verified training-data count | The benchmark report identifies 0 independently verified spec-import gold cases. No training manifest or private train/dev/holdout examples were present or accessible in the reviewed workspace. | **0 verified examples available to authorize this run.** This does not count any external restricted store that was not accessible for review. |
| Privacy and provenance | The retained 51-workbook corpus contains real customer data and was not sent to a provider. Its deterministic snapshots are regression expectations, not independent extraction gold. The dataset safety review found the proposed package/gap patch did not bind caller-supplied hashes, IDs, and gold values to submitted content and source evidence. No training data was generated or retained. | **Not cleared.** Do not use the retained workbook corpus or proposal archives as training data. |
| Available compute | This workspace has 8 logical CPUs and about 15.6 GiB RAM. No NVIDIA device/driver is visible, `ollama` is unavailable, and `LOCAL_AI_BASE_URL` is not configured. No approved remote GPU host or rental was identified. | **Insufficient for the proposed GPU run.** |
| Reproducible experiment pins | No selected base checkpoint, tokenizer revision, chat-template identity, training-library versions, private split, or training/evaluation run exists. The current production parse/cache version is 41; the production output type has no separate schema-version declaration. | **Not pinned; no experiment started.** |

## Evidence and provenance

The reviewed Phase-0 blocker records:

- 51 retained source workbooks, of which 19 are spec workbooks, but **0 independently verified spec-import gold cases**.
- 304 historical discrepancy-review labels, excluded because they measure discrepancy detection rather than extracted-field correctness.
- No benchmark Gemini/local provider requests or side-by-side measurements.
- No approved local endpoint or model identity.
- Metadata-only retention and no provider payloads.

The benchmark report names source revision `7f41f4931c459a3f273af7554d5527503d1d98f9`, which is not present in this checkout. The dataset-safety review is bound to `87407c209a2a7d9cd179986dc9eb46ed579529fc`, an ancestor of the reviewed checkout, and says no newer revision-bound provider comparison was found. No later provider-comparison report or eligible training dataset was found in the reviewed project files. Treat the benchmark report as a blocker snapshot, not as current model-quality measurements.

The 1,500-example figure in the supplied QLoRA notes is a planning heuristic, not a universal minimum or evidence that such examples exist. Training eligibility would require individually verified examples with source-backed gold or authorized human Apply evidence, privacy review, prompt/parse identity, and brand-grouped splits with an untouched holdout. Counts from unavailable private stores remain unknown and cannot be treated as eligible.

Evidence files reviewed:

- `docs/evidence/local-spec-import-benchmark-blocker-2026-10-02.md` — SHA-256 `1803a7bc5b917387c3f3ac03bfbd8e1937a74ac7a7d6d9913562cb0ea3257601`
- `docs/evidence/distillation-dataset-safety-review-2026-10-02.md` — SHA-256 `8a83eca4f12c61967a7fee693ab787261769994bc42494106a0c3d48c9573508`
- `docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md` — SHA-256 `a03e4901765311bae398427540952d8f5c89758539caf3de73ea88f111c4e30f`
- `docs/ai-corrections-evaluation-data-audit-2026-10-02.md`

## Criteria required before reconsidering training

1. Complete a revision- and prompt-bound Phase-0 comparison using the same independently verified cases for Gemini and an approved, identified local base model. Establish a persistent, material gap using a threshold agreed before evaluating results. A missing measurement is not evidence of a gap.
2. Establish the count and provenance of usable examples in an access-controlled dataset. Keep raw workbooks and messages outside Git; reject examples without source-backed gold or an authorized human Apply record. Do not use deterministic parser snapshots or discrepancy-review labels as extraction gold.
3. Confirm compute is available and approved before any run. Record the actual hardware/resource limit rather than relying on the research estimate.
4. Before training, pin the base model and digest, tokenizer and revision, exact production prompt and chat template, parse/cache and output-schema identity, training-library versions, data split, seed, and evaluation prompt/settings. Train on assistant responses only; measure and report truncation, and keep holdout data untouched.
5. Compare the trained candidate, well-prompted base model, and Gemini on the **same untouched holdout**. Before a run, agree the minimum material gain over the prompted base; that threshold is not established in the current evidence.

For any later candidate, these are the current Phase-0 comparison targets; they are not evidence that any model passes:

- Schema-valid rate: at least Gemini minus 1 percentage point, or at least 99% absolute.
- Critical-field agreement: target at least Gemini minus 3 percentage points. Any result below this target is not promotable; a gap greater than 5 points is a hard fail.
- Overall field agreement: at least Gemini minus 5 percentage points.
- Blank-poison: zero cases; any occurrence is a hard fail.
- Empty-output rate: no more than Gemini plus 1 percentage point.
- Systematic missing required fields: hard fail.

No model is promoted unless it also meets the pre-agreed material-improvement threshold over the well-prompted base. Production routing and import review remain unchanged.

## Work performed for this decision

- Reviewed the current benchmark blocker, dataset-safety review, local-adapter decision, correction/evaluation-data audit, and supplied experiment design.
- Checked the current workspace for dataset manifests, training JSONL, model weights, local GPU access, Ollama, and local-endpoint configuration.
- No model training, provider request for this decision, data backfill, training-example creation, model-weight export, or production routing change was performed.