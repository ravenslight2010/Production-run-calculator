# Spec-import provider comparison gate review — blocked

**Review date:** 2026-10-08  
**Current source revision:** `e5c4e620e53eeb48830913b3031a3db260be45bf`  
**Decision:** Not authorized to run; no provider comparison was made.  
**Privacy:** Repository code and metadata only. No workbook contents, source-backed labels, private evidence stores, prompts containing source data, credentials, or provider responses were accessed or retained.

## Gate decision

The current review found **0 eligible independent gold cases** in the reviewed workspace and no authorized Apply-evidence bundle. Cases in unreviewed private stores remain **unknown**; those stores were not accessed. An evaluation-only local model target is now owner-approved (see below), but no endpoint has been provided or verified for this evaluation and there is no separate authorization for a Phase-0 provider run.

Do not call either provider for this comparison, treat unavailable measurements as zero, train a model, create dataset splits, or change production routing. The local model selection is evaluation-only; this remains a blocked, unmeasured comparison—not evidence that Gemini is better or that a local model fails.

Eligibility and authorization were assessed against the independent review protocol in the existing benchmark blocker report. It requires authorized source evidence; two independent labels made without model/parser outputs; separate adjudication; restricted provenance and reviewer records; and a privacy review. Existing deterministic snapshots and discrepancy-review labels do not qualify as extraction gold.

## Current production identity

The earlier benchmark record is bound to source revision `7f41f4931c459a3f273af7554d5527503d1d98f9` and parse version `41`. This review checked the current repository revision above: the parse version is now `42`. The production system-prompt digest was recomputed from the current prompt builder with empty workbook input and remains the same as the earlier record. **No comparison was run against parse version 42.**

| Identity or setting | Current code-backed value | Comparison status |
| --- | --- | --- |
| Parse version | `SPEC_IMPORT_PARSE_VERSION` `42` | Identified; no run |
| Production system prompt | SHA-256 `65196b19789f6f1cc676c45f00e32b14c34320f869766e8f6c711a351e9f9d76` | Identified; no run |
| Empty-input user-prompt template | SHA-256 `259e965be5921e54b93f0ab17d1ba9663cd2a0e65d167bafda0363243ea43ccc` | Template fingerprint only; not a case prompt |
| Case-specific grounded user prompts | No eligible cases; route also adds learned-memory grounding | Not available to freeze |
| Output contract | `ParsedSpecImport` (`profiles`, `recipes`, optional `note`, `warnings`, and `unresolved`), passed through `sanitizeParseSpecSheet` / `sanitizeParsedSpecImport` | No separate output-schema version is declared |
| Current Gemini route identity | Replit AI Integrations; `pickModel("full")` resolves to `gemini-2.5-flash` | Production identity only; no benchmark request |
| Local provider/model | Owner-approved evaluation target: Ollama with `qwen3:8b` (Qwen3 8B); endpoint and immutable model digest not yet verified | No verified endpoint; not run |
| Structured-output request | `json_object`; `max_completion_tokens` `65536` | Current route settings; not frozen as a side-by-side protocol |
| Sampling settings | No explicit temperature, top-p, or seed in this route | Provider defaults are not pinned |
| JSON retry policy | At most 2 total attempts; retry malformed JSON once; retry a 429 once after 20 seconds; do not retry other provider-call errors | Current route behavior; no benchmark retries occurred |

The empty-input template digest does not represent the per-case prompt sent to a provider. Before any future comparison, authorized cases and the exact grounded prompts must be frozen in restricted storage; shared evidence must contain only approved metadata and digests.

## Pre-agreed acceptance thresholds

The existing Phase-0 design sets these starting thresholds for a local candidate against Gemini on the same verified cases:

| Measure | Acceptance threshold |
| --- | --- |
| Schema validity | At least Gemini minus 1 percentage point, or at least 99% absolute |
| Critical-field agreement | At least Gemini minus 3 percentage points |
| Overall field agreement | At least Gemini minus 5 percentage points |
| Blank-poison | Zero cases; any occurrence is a hard fail |
| Empty-output rate | No more than Gemini plus 1 percentage point |
| p95 latency | Reported; informational in Phase 0 |

Any blank-poison case, a critical-field gap over 5 percentage points, or systematic missing required fields blocks local promotion. These are acceptance criteria, not measured results or authorization to run.

## Measurements and execution status

No cases, prompts, provider calls, retries, or comparison outputs were executed. No measurement failed; measurements are unavailable because the run was not authorized, zero eligible gold cases were found, and no endpoint or immutable model digest has been verified.

| Measurement | Gemini | Local candidate |
| --- | --- | --- |
| Schema-valid rate | Unavailable — not run | Unavailable — approved model has no verified endpoint; not run |
| Field-level agreement | Unavailable — no verified gold | Unavailable — no verified gold |
| Critical-field agreement | Unavailable — no verified gold | Unavailable — no verified gold |
| Blank-poison rate | Unavailable — no comparison outputs | Unavailable — no comparison outputs |
| Empty-output rate | Unavailable — no comparison outputs | Unavailable — no comparison outputs |
| Latency p50 / p95 | Unavailable — not run | Unavailable — no verified endpoint; not run |

## Evidence hashes

All hashes below identify repository metadata or code, not customer source material.

| Evidence | SHA-256 |
| --- | --- |
| Earlier benchmark blocker report, including its 2026-10-08 metadata-only gold-case review and 2026-10-07 model-approval addendum | `4d1c9a945012551464cca752336d0a81824fbeacde85cfeb88be9a6e18e1366d` |
| Dataset-safety review | `8a83eca4f12c61967a7fee693ab787261769994bc42494106a0c3d48c9573508` |
| Backfill decision JSON | `229721e6dca77b551c01cf6462e8ebfdf73bd1f33e2ab874cc19d2f274b0f172` |
| Current prompt builder source | `ce1ebc4a2ccf070bca027dd0e3984a8ab8dbc7df1e95988bd87913241fd69379` |
| Current parse route source | `fe1b90d45de67d15064d171bb70ee9aa8c62d7e9770d5d01b10623815ccc3156` |
| Current retry policy source | `be2f486c4185f09b58991f49df3da89852752dc5ea408f4406d37c44c5568c95` |
| Current bounded-JSON bridge source | `a7f6773685c891a4192aa95868f28294dd806d307c5e032e8d1356455615dea6` |
| Current reviewed-document extraction source | `ea376ff281b3ef75d640c2a06429d4813392dfd4babf7858a995fd1841fda9b5` |
| Current parse contract and sanitizer source | `276b457fe32cc7c4ac3a9628626e188c15aab978d468cf069a2d05a621cd22bf` |
| Current Gemini model mapping source | `65a7d0def2527953c2e3ec6d4dc206d45c5ee34bbe3bba8934d50c27863e1cc9` |

## Evaluation-only local model approval

**Approval date:** 2026-10-07
**Authorization:** The project owner accepted the recommended model and safeguards for spec-import evaluation only. This does not authorize a provider request, use of customer content, or a production routing change.

| Item | Approved evaluation target |
| --- | --- |
| Provider/runtime | Ollama, using its OpenAI-compatible chat-completions endpoint |
| Model/version | Qwen3 8B instruct, Ollama model tag `qwen3:8b`. The immutable model digest must be captured and verified before any request; it was not supplied or captured for this decision. |
| Endpoint | Intended loopback target: `http://127.0.0.1:11434/v1` on a dedicated evaluator-controlled host. No endpoint host/service was verified or contacted during this review. |
| Endpoint owner | Project owner who authorized the evaluation target; any other endpoint operator must be explicitly designated by that owner before setup. Record the actual operator and host in the restricted run record, not this shared report. |
| Data handling | No customer or operational content for this approval. Until source-backed cases are separately authorized, only generated/non-sensitive test inputs may be used. Any later source material remains subject to the independent source review and its restricted-storage protocol. |
| Retention | Do not persist request prompts, source contents, or raw model responses; disable payload logging. Retain only privacy-reviewed aggregate metrics and non-sensitive run metadata, including model/prompt digests. |
| Access | Bind to loopback; do not expose the service to LAN or public networks. Restrict the host to the project owner or an explicitly designated evaluator. |
| Resource limits | One concurrent request; maximum 32,768-token context and 120-second request deadline. Run on a dedicated evaluation host, never on the production API/Render instance. Set and verify host-level CPU, memory, and accelerator limits before the run; this review did not identify a host or configured limits. |

Before any future call, verify the endpoint is loopback-only, enforce the stated controls and egress restrictions, record the actual endpoint operator/host in restricted evidence, pin the model digest, complete the independent source-backed case review, and obtain separate Phase-0 run authorization. No package was installed as part of this decision, and no provider was called.

The model choice follows the project's earlier local-AI installation research, which proposed Qwen3 8B as a text-only Phase-0 candidate for spec parsing. This is a fit-based recommendation, not a measured quality result.

## Conditions for a future run

Reconsider only after the independent source-backed case review is complete, the approved local endpoint is deployed and its operator, host, model digest, and resource limits are verified, and a separate Phase-0 run is authorized. At that point, refresh the parse/prompt/schema identity, freeze the same eligible cases and case-specific prompts for both providers, pin all available sampling and retry settings, and retain only privacy-reviewed metadata with separate evidence hashes. Keep training, dataset splits, and production routing changes out of that decision unless separately authorized.
