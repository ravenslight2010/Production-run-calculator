---
name: AI delivery governance
description: Project decision on evaluating and governing AI-assisted software changes.
---

Evaluate AI-assisted work by its end-to-end delivery cost: implementation, review, testing, security verification, rework, and release evidence. Faster code generation alone is not a project success metric.

Retain independent automated checks and human approval for consequential changes. Do not add code-level AI-origin tagging or vendor governance tooling unless a concrete compliance, audit, or incident-response requirement makes it useful.

**Why:** AI can increase code volume while shifting effort downstream. This project already has focused safety checks and revision-bound release evidence; adding generic provenance machinery would create maintenance cost without improving a defined decision.

**How to apply:** When considering new AI tooling or process, identify the specific downstream bottleneck or risk it addresses and how success will be measured. Prefer narrow improvements to existing validation and review paths over broad tracking systems.