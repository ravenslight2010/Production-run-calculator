---
name: Case-based production input validity
description: Fail-closed rule for Sauce and Frontline quantities when package count is missing.
---

When a run requests cases but Pizzas Per Case is not positive, every case-based Sauce and Frontline quantity is unavailable. Fixed buffers must not appear alone as plausible pounds, batches, pulls, exports, progress, or automatic claims.

**Why:** A missing package count can reduce an otherwise large requirement to only the fixed buffer, producing a small but believable batch total that operators may trust.

**How to apply:** Use the shared availability predicate and summary result at every quantity boundary. Keep the established buffers and extra-layer allowance unchanged for valid runs, show an actionable setup warning, and independently fence live claims against stale nonzero calculations.