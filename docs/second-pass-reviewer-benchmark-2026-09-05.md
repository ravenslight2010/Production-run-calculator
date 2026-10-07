# Second-Pass Reviewer Benchmark

**Decision date:** 2026-10-06 (fresh measurement of the 2026-09-05 corpus)
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

Live-observation command:

`pnpm --filter @workspace/api-server run benchmark:second-pass-reviewer-live -- ../../docs/second-pass-reviewer-live-observations-2026-09-05.json`

The runner uses an isolated copy of the retired reviewer prompt and
sanitization helpers under `scripts/`; it does not restore the removed
`@workspace/ai-review` application package or add a reviewer path to the app.
The versioned observation file records the capture time, environment,
toolchain, lockfile digest, evaluator digest, and source identity state. It
retains no prompts or provider responses.

The former runner sent serialized finding records from the pinned source-library
reconciliation artifact to Gemini. It saved only:

- its SHA-256 digest;
- aggregate labeled-case counts;
- paired control/reviewer contribution categories;
- bounded operation-level cost, cache, retry, and latency effects;
- the threshold decision.

The saved file did not include source rows, names, prompts, model responses, or
reviewer reasons. The paired control was deterministic reconciliation plus
mandatory human review. The treatment asked whether a serial full-model reviewer
could receive unique credit over that same evidence boundary.

## Outcome

The labeled retained corpus contains 304 cases: 101 material discrepancies already surfaced by deterministic source reconciliation and 203 unresolved non-material records left for human review. The fresh five-request full-model run captured on 2026-10-06 observed:

- **Unique material catches:** 0.
- **Duplicate warnings:** 0.
- **False warnings / false rejects:** not measurable; all 203 non-material cases were inside failed batches, so this threshold fails closed.
- **No-op verdicts:** 304, including the fail-open no-op fallback for failed batches.
- **Reviewer failures:** 301 of 304 cases across four of five operation batches.

The four failed batches recorded a `SyntaxError` classification; raw provider
responses were not retained, so the report does not make a stronger claim about
their contents. The successful batch covered three cases and returned two
three no-op verdicts. Each operation issued one logical provider request and
all five recorded zero provider retries. Observed batch latency
ranged from 10.590 to 19.084 seconds, with a 19.084-second p95. Token counts
were available for only one operation (726 input and 148 output tokens); total usage
and cost remain unavailable, so the cost threshold fails closed rather than
using an estimate.

The current observation and report bind the run to Node 24.21.0, pnpm 12.8.1,
lockfile SHA-256
`3a25a065ab3926f3a4a1f5fda1121485174d2e3271965d6201aef95fce38fecd`, evaluator
SHA-256 `53c77a1ff4944bf77f773c18cde93d7cc0342ac17400ca15b0e6d1220dba08da`, and
source-data SHA-256
`1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294`. The
observation records the full source revision as unknown. Its evaluator,
lockfile, and source-data hashes are recorded, but the report is not a
standalone full-source attestation.

## Decision

**Remove the second-pass reviewer from all operations.**

It failed the minimum unique-catch count and rate before cost or latency could justify retention. Keeping it would add paid latency while producing advisory metadata that neither blocks a bad suggestion nor authorizes a good one.

The app-level reviewer has been retired. The isolated helper remains only for
this historical benchmark and is not imported by the app.

## Regression gate

- The benchmark test fixes the acceptance thresholds and contribution categories.
- The aggregate output is source-hash bound to the pinned reconciliation evidence.
- The API route test requires one primary model call, preventing a paid reviewer call from returning unnoticed.
- Any future proposal to restore a reviewer must add separately labeled, uniquely missed material cases and rerun this evidence. Reviewer agreement alone is not correctness evidence.