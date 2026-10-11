---
name: Local model memory headroom
description: Resource planning for Qwen3 8B Phase-0 inference at 32K context in the shared workspace
---

For the approved Qwen3 8B profile at a 32,768-token context, a nominal 16-GiB cgroup limit is not proof of fit on the shared workspace. Ollama estimated 12.3 GiB required while only 10.6 GiB was available with application workflows running, and refused model loading.

**Why:** The synthetic request failed at the runtime memory guard before inference; no OOM occurred. Reducing context or stopping user-facing workflows would not verify the approved profile on its dedicated evaluator.

**How to apply:** Measure available memory on the actual evaluator with its normal background services active. Require enough headroom for the full runtime estimate, or use a dedicated host; do not treat a failed load as a model-quality result.
