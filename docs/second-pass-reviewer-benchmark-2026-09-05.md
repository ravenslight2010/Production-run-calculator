# Second-Pass Reviewer Benchmark

**Decision date:** 2026-09-05  
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

`pnpm --filter @workspace/scripts run benchmark:second-pass-reviewer -- ../docs/second-pass-reviewer-benchmark-2026-09-05.json`

Live observations can be reproduced deliberately (this spends provider budget):

`pnpm --filter @workspace/api-server run benchmark:second-pass-reviewer-live -- ../../docs/second-pass-reviewer-live-observations-2026-09-05.json`

The benchmark reads the pinned source-library reconciliation artifact and emits only:

- its SHA-256 digest;
- aggregate labeled-case counts;
- paired control/reviewer contribution categories;
- bounded operation-level cost, cache, retry, and latency effects;
- the threshold decision.

It does not emit workbook rows, names, prompts, model responses, or reviewer reasons. The paired control is the existing deterministic reconciliation plus mandatory human review. The treatment asks whether a serial full-model reviewer can receive unique credit over that same evidence boundary.

## Outcome

The labeled retained corpus contains 304 cases: 101 material discrepancies already surfaced by deterministic source reconciliation and 203 unresolved non-material records left for human review. The live full-model reviewer run observed:

- **Unique material catches:** 0.
- **Duplicate warnings:** 3.
- **False warnings / false rejects:** not measurable; all 203 non-material cases were inside failed batches, so this threshold fails closed.
- **No-op verdicts:** 301.
- **Reviewer failures:** 301 of 304 cases across four of five operation batches because the responses were not usable JSON.

The reviewer also imposed one additional serial full-model call on every non-empty miss. For cheap-model resolution operations this was a full-model call after a cheap primary call. Its separate ten-minute process-local cache did not share the durable result cache, retries were not applied, and cache misses on another API process could spend again. Observed batch latency ranged from 9.6 to 24.2 seconds, with a 24.2-second p95. The provider adapter did not return token usage, so the benchmark records cost ratio as unmeasured and fails that threshold closed instead of inventing a cost estimate.

## Decision

**Remove the second-pass reviewer from all operations.**

It failed the minimum unique-catch count and rate before cost or latency could justify retention. Keeping it would add paid latency while producing advisory metadata that neither blocks a bad suggestion nor authorizes a good one.

The compatibility helper remains temporarily as a no-cost, empty-verdict boundary so response contracts do not churn during adjacent AI consolidation work. It cannot call a model, spend budget, cache reviewer output, or alter suggestions.

## Regression gate

- The benchmark test fixes the acceptance thresholds and contribution categories.
- The aggregate output is source-hash bound to the pinned reconciliation evidence.
- The API route test requires one primary model call, preventing a paid reviewer call from returning unnoticed.
- Any future proposal to restore a reviewer must add separately labeled, uniquely missed material cases and rerun this evidence. Reviewer agreement alone is not correctness evidence.