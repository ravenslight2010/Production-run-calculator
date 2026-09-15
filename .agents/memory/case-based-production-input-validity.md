---
name: Case-based production input validity
description: Fail-closed rule for Sauce and Frontline quantities when package count is missing.
---

When a run requests cases but Pizzas Per Case is not positive, every case-based Sauce and Frontline quantity is unavailable. Fixed buffers must not appear alone as plausible pounds, batches, pulls, exports, progress, or automatic claims.

**Why:** A missing package count can reduce an otherwise large requirement to only the fixed buffer, producing a small but believable batch total that operators may trust.

**How to apply:** Use one shared availability rule before any workflow accepts a case target and at every quantity boundary. Drafts may be saved, but they are not production-ready until the case pack is valid. Keep valid-run buffers unchanged and independently fence live claims against stale nonzero calculations.