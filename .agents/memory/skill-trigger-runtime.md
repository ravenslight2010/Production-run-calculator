---
name: Skill trigger runtime evaluation
description: Runtime trigger benchmarks depend on an authenticated Claude CLI and the evaluator's skill-creator working directory.
---

The skill-trigger benchmark cannot produce model evidence when the `claude` executable is unavailable; `run_eval.py` converts subprocess failures into false/non-trigger results, so those rates must be reported as unavailable rather than scored.

**Why:** A complete benchmark attempt can otherwise look like systematic under-triggering even though no model was consulted.

**How to apply:** Verify `command -v claude` before running the corpus. For alternate providers, keep provider metadata and failure/uncertainty exclusions separate from Claude evidence; never score unavailable calls as negatives.