# PWA recovery guidance evaluation

## Method

- Three independent, secret-free prompts cover a pre-Home stale lazy chunk, the
  exact Safari `Can't find variable: Notification` error, and an unrelated
  current-build 503 for a lazy chunk while a form contains unsaved input.
- Each prompt was run once with the current error-handling skill and once with a
  snapshot of the prior skill. The prior-skill baseline was asked not to consult
  the PWA policy; this compares the routing guidance, not a no-skill agent.
- Final responses were retained under `iteration-1/` and `iteration-2/`.
  `grade_eval.py` applies the same 11 objective checks to each configuration.
  The saved responses were also reviewed against the assertions.
- Iteration 1 exposed one miss: the current-skill stale-Home response required
  the two snapshots but summarized the remaining gates as “after the state is
  confirmed safe,” omitting the uninterrupted one-minute idle interval and
  recheck before worker recovery.
- The error-handling route now asks the agent to state applicable opt-in and
  safe-state gates explicitly rather than compressing them to “when safe.”
  The policy itself was not changed. All three prompts were rerun against that
  revision and the same prior-skill baseline.

## Results

| Iteration | Configuration | Passed | Total | Result |
| --- | --- | ---: | ---: | --- |
| 1 | Current skill | 10 | 11 | 90.9% |
| 1 | Prior skill | 5 | 11 | 45.5% |
| 2 | Current skill | 11 | 11 | 100% |
| 2 | Prior skill | 4 | 11 | 36.4% |

Per-case scores:

| Iteration | Configuration | Stale Home | Exact Safari error | Unrelated 503 |
| --- | --- | ---: | ---: | ---: |
| 1 | Current skill | 3/4 | 4/4 | 3/3 |
| 1 | Prior skill | 1/4 | 1/4 | 3/3 |
| 2 | Current skill | 4/4 | 4/4 | 3/3 |
| 2 | Prior skill | 1/4 | 0/4 | 3/3 |

The current guidance distinguished the two applicable PWA recovery cases from
the unrelated 503 in both iterations. After the routing clarification, its
stale-Home response stated the dual snapshot proof, fail-closed uncertainty,
other unsafe-state blockers, one-minute idle interval, and safety recheck.
The prior-skill baseline handled the unrelated transient network failure safely
in both runs, so that near-miss does not demonstrate a skill-specific benefit.

## Limitations and boundaries

- This was one model response per prompt and configuration per iteration; the
  scores are a small guidance check, not a statistically stable benchmark.
- The comparison retained final responses, not full tool transcripts, and the
  environment did not provide per-run token or duration metrics.
- The baseline used the previous error-handling skill snapshot and was
  intentionally prevented from reading the PWA policy. It is not a no-skill
  comparison.
- This evaluates agent guidance only. No PWA runtime code was changed, and the
  Playwright PWA handoff test or physical-device/browser behavior was not
  rerun. The existing `artifacts/run-calculator/e2e/pwa-handoff.spec.ts`
  remains the runtime test contract.
- `check:skill-catalog` completed with zero failures but reported one
  undocumented warning in the managed
  `.local/secondary_skills/tiktok-ads/SKILL.md` for broken local references.
  Managed skills were not changed.
