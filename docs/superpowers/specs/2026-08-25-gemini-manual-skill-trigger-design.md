# Gemini and Manual Skill-Trigger Benchmark

## Status

Design approved by the user on 2026-08-25. Implementation is intentionally
blocked until the user reviews this written specification.

## Goal

Provide useful skill-trigger evidence without requiring Claude Code
authentication. Gemini will evaluate the full held-out benchmark, while a
manual-review queue will capture only Gemini failures and uncertain cases.
Claude results remain explicitly unavailable and are never replaced by Gemini
results.

## Scope

### In scope

- A provider-neutral benchmark evaluator with a Gemini provider.
- Strict structured output for each prompt: trigger, do-not-trigger, or
  uncertain, with a bounded confidence and rationale.
- Gemini precision, recall, false-positive, and false-negative metrics.
- A Markdown/JSON report that identifies the provider and run configuration.
- A manual-review queue for API failures, malformed responses, low-confidence
  responses, and expectation disagreements.
- Tests for provider errors, malformed output, uncertainty routing, and metric
  calculations.

### Out of scope

- Editing skill descriptions automatically.
- Reclassifying the previous Claude CLI failures as model observations.
- Calling Claude Code or requiring an Anthropic account.
- Blending manual decisions into Gemini metrics without labeling them.
- Building a UI; the manual queue is a reviewable file artifact.

## Proposed architecture

The existing benchmark corpus remains the source of prompts and expected
labels. A new evaluator layer accepts a provider adapter. The Gemini adapter
uses the configured Gemini integration through the repository's existing
credential mechanism; credentials are never written to files, reports, logs,
or prompt fixtures.

For each skill/prompt pair, the evaluator sends Gemini the skill name,
trigger description, benchmark prompt, and expected label context needed for
classification. Gemini must return a small JSON object containing:

- `decision`: `trigger`, `do_not_trigger`, or `uncertain`
- `confidence`: numeric value from 0 through 1
- `rationale`: short bounded explanation

The evaluator validates the response, applies a documented confidence
threshold, and records provider errors separately from valid classifications.
It retries only transient provider failures within a bounded limit. It does
not silently convert errors to negative triggers.

## Data flow and artifacts

1. Load the existing 25-skill, 100-prompt benchmark.
2. Run Gemini against every prompt using bounded concurrency and retries.
3. Validate and normalize each response.
4. Calculate Gemini-only metrics from valid non-uncertain decisions.
5. Write a provider-labeled JSON result artifact.
6. Write a Markdown report with run metadata, metrics, exclusions, and limits.
7. Write a manual-review queue containing only unresolved or uncertain cases.
8. A reviewer records a decision and reason in the queue; manual decisions are
   reported separately from Gemini metrics.

The queue must preserve the original prompt, skill, expected label, Gemini
response/error, and a blank manual decision field. It must not include secrets
or full provider request payloads.

## Failure and safety behavior

- Missing Gemini credentials or unavailable provider: fail the run clearly and
  produce no fabricated metrics.
- Malformed or schema-invalid Gemini output: route the case to manual review.
- Low confidence or `uncertain`: route the case to manual review.
- A valid disagreement with the expected label is a Gemini result and remains
  in the metrics; it is also included in manual review so it can be checked.
- Provider rate limits/timeouts: bounded retry, then manual-review routing.
- Reports must say that Gemini measures Gemini behavior and is not evidence of
  Claude behavior.
- Existing Claude benchmark files remain unchanged unless a separate,
  provider-aware report explicitly updates their status wording.

## Testing and acceptance criteria

- Unit tests cover valid decisions, invalid JSON, invalid enum values,
  confidence bounds, transient failure retry, permanent failure routing, and
  metric math.
- A deterministic fixture provider can run the evaluator without network
  access.
- A real Gemini smoke run is performed only when the configured integration is
  available; its evidence records the provider and timestamp.
- The full run produces all three artifacts: JSON results, Markdown report,
  and manual-review queue.
- No generated report claims Claude measurements.
- No skill description changes are made by the evaluator.

## Alternatives considered

### Local open-source model

Avoids external authentication, but introduces model/runtime variability and
is less suitable for comparable release evidence.

### Manual-only review

Provides direct human judgment but is slower and less repeatable across the
full corpus.

Gemini plus targeted manual review is preferred because it preserves
repeatability while limiting human work to the cases that need judgment.