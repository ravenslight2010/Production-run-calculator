---
name: Local model memory headroom
description: Historical Qwen3 8B/32K headroom finding; re-evaluate the currently pinned model and context
---

For an earlier Qwen3 8B profile at a 32,768-token context, a nominal 16-GiB cgroup limit was not proof of fit on the shared workspace. Ollama estimated 12.3 GiB required while only 10.6 GiB was available with application workflows running, and refused model loading. This is historical evidence for that exact profile, not a claim about a later model or context.

**Why:** The synthetic request failed at the runtime memory guard before inference; no OOM occurred. Reducing context or stopping user-facing workflows would not verify the approved profile on its dedicated evaluator.

**How to apply:** Re-read the current model pin and context, then measure available memory on the actual evaluator with its normal background services active. Require enough headroom for the full runtime estimate; do not infer fit from a cgroup cap or treat a failed load as a model-quality result.

For repeated-start comparisons, preserve the host's caches and label runs by
their actual order rather than claiming a guaranteed cold or warm cache state.
Treat cgroup `memory.peak` as cumulative; use before/after readings alongside a
sampled `memory.current` high-water instead of resetting the kernel counter.

**Why:** Clearing caches or resetting cgroup accounting would alter the runtime
being measured and could discard evidence from earlier processes.

**How to apply:** Keep startup reports observational: measure multiple
consecutive starts, retain cgroup baselines and end values, and report only
whether a start was first or repeated unless cache state is independently
controlled and verified.
