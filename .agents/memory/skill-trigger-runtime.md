---
name: Skill trigger runtime evaluation
description: Runtime trigger benchmarks depend on an authenticated Claude CLI and the evaluator's skill-creator working directory.
---

The skill-trigger benchmark cannot produce model evidence when the `claude` executable is unavailable; `run_eval.py` converts subprocess failures into false/non-trigger results, so those rates must be reported as unavailable rather than scored.

**Why:** A complete benchmark attempt can otherwise look like systematic under-triggering even though no model was consulted.

**How to apply:** Verify `command -v claude` before running the corpus. Invoke `run_eval.py` from `.agents/skills/skill-creator` (or provide its package path) so its `scripts.utils` import resolves.