---
name: QLoRA power margin boundary
description: Strict promotion-margin handling in paired power simulations.
---

An exact gain equal to an approved QLoRA margin must not count as detection. Apply a small numerical tolerance consistently when comparing simulated lower bounds and when deciding whether the development estimate is above a target.

**Why:** Per-case agreement differences such as 0.85 minus 0.80 can round slightly above 0.05 in floating-point arithmetic, accidentally satisfying a strict greater-than margin.

**How to apply:** When changing the QLoRA promotion or preflight margins, preserve strict-boundary behavior in both the Monte Carlo detection check and the evaluator. Keep a synthetic exact-margin case that proves it remains insufficient.