# Gemini skill-trigger benchmark

- Provider: **gemini**
- Model: **gemini-2.5-flash**
- Run at: **2026-08-25T22:37:27.774333+00:00**
- Scope: Gemini classification only; this is not evidence of Claude behavior or Claude tool selection.

## Metrics

- Evaluated: **98**; excluded: **2**
- Accuracy: **0.918**
- Precision: **0.862**
- Recall: **1.000**
- False-positive rate: **0.167**
- False-negative rate: **0.000**

Excluded cases are not treated as do-not-trigger decisions. See the manual-review queue for provider failures, invalid or uncertain responses, and disagreements.

## Manual review

The queue is intentionally read-only input for review. List unresolved cases
with:

```sh
python scripts/gemini_skill_trigger_benchmark.py review \
  list
```

Record a manual decision and its reason in the separate
`gemini-skill-trigger-manual-decisions.json` artifact:

```sh
python scripts/gemini_skill_trigger_benchmark.py review \
  decide \
  --id customer-import-audit-near-miss-1 \
  --decision do_not_trigger \
  --reason "This is a post-import data audit, not an import-pipeline change."
```

Use `--queue` and `--decisions` to work with alternate artifact paths. Manual
decisions are never read by the benchmark evaluator and therefore never
change Gemini metrics. Re-running the benchmark refreshes only the Gemini
results, report, and review queue; the separate decisions artifact remains
untouched.
