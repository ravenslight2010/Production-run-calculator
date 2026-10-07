# Second-Pass Reviewer Benchmark

**Decision date:** 2026-10-06 (fresh measurement of the 2026-08-26 corpus)  
**Capture time:** 2026-10-07T02:22:10.933Z (UTC)  
**Scope:** Retained document extraction and unresolved-name workflows  
**Authority:** Deterministic sanitizers, canonicalization, source evidence, and explicit human confirmation

## Acceptance criteria

These thresholds were defined before reading the benchmark aggregate:

- At least 5 uniquely caught material errors.
- At least a 20% unique material catch rate.
- At most a 5% false-warning rate.
- Added cost no greater than 35% of the primary operation.
- Added p95 latency no greater than 1.5 seconds.
- Reviewer failure rate no greater than 5%.

All thresholds must pass for an operation to retain the reviewer. A reviewer flag receives no unique-catch credit when deterministic reconciliation, canonicalization, source evidence, or mandatory human review already identified the same issue.

## Method

```text
pnpm --filter @workspace/scripts run benchmark:second-pass-reviewer -- ../docs/second-pass-reviewer-benchmark-2026-10-06.json
pnpm --filter @workspace/api-server run benchmark:second-pass-reviewer-live -- ../../docs/second-pass-reviewer-live-observations-2026-10-06.json
```

The isolated benchmark uses the retired reviewer prompt and sanitization helpers under `scripts/`; it does not restore the removed `@workspace/ai-review` application package or add a reviewer path to the app. The observation file records capture time, environment, toolchain, lockfile digest, evaluator digest, and source identity state. It retains no prompts or provider responses.

The live run sent the selected source-library finding records to Gemini. The retained observations contain only the source digest, aggregate labeled-case counts, paired contribution categories, bounded operation-level metrics, and threshold decision. The deterministic reconciliation plus mandatory human review is the control.

## Outcome

The corpus contains 304 cases: 101 material discrepancies already surfaced by deterministic source reconciliation and 203 unresolved non-material records left for human review. The five-request full-model run used `gemini-2.5-flash` and produced:

- **Unique material catches:** 0.
- **Duplicate warnings:** 0.
- **No-op verdicts:** 304.
- **Reviewer failures:** 301 of 304 cases across four of five operation batches (99.0%).
- **False-warning rate:** unavailable; all 203 non-material cases were in failed batches, so the threshold fails closed.

The four failed batches recorded a `SyntaxError` classification. Raw provider responses were not retained, so this report does not make a stronger claim about their contents. The one successful batch covered three material cases and returned no warnings. All five operation batches recorded one provider request and zero provider retries.

Observed batch latency ranged from 4.827 to 18.529 seconds, with an 18.529-second p95. Token counts were available for only the successful batch (726 input and 147 output tokens); total token usage and cost remain unavailable, so the cost threshold fails closed.

The report is bound to Node 24.21.0, pnpm 12.8.1, lockfile SHA-256 `3a25a065ab3926f3a4a1f5fda1121485174d2e3271965d6201aef95fce38fecd`, evaluator SHA-256 `53c77a1ff4944bf77f773c18cde93d7cc0342ac17400ca15b0e6d1220dba08da`, and source-data SHA-256 `1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294`. The full source revision is explicitly unknown because the worktree was dirty at capture time; the evaluator, lockfile, source data, and observation file are separately hashed.

## Decision

**Do not retain the second-pass reviewer.**

It failed the minimum unique-catch count and rate, reviewer-failure rate, and p95 latency thresholds. Cost is unavailable and the false-warning threshold fails closed. The app-level reviewer remains retired; this benchmark does not restore it.

## Regression gate

- The benchmark test fixes the acceptance thresholds and contribution categories.
- The aggregate output is source-hash bound to the pinned reconciliation evidence.
- The API route test requires one primary model call, preventing a paid reviewer call from returning unnoticed.
- Any future proposal to restore a reviewer must add separately labeled, uniquely missed material cases and rerun this evidence. Reviewer agreement alone is not correctness evidence.
