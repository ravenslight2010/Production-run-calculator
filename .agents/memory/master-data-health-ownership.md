---
name: Master-data health ownership
description: Launch classification rules for legacy setup records and purchased crust recipes.
---

Legacy brand-level setup rows and stale recipe-name links can retain operational defaults or inline formulas even when their identity is incomplete. Purchased crust recipes likewise legitimately have no in-house component formula.

**Why:** Treating these records as hard errors either blocks launch on known historical data or pressures an automatic rewrite of protected manager data.

**How to apply:** Keep them as warning findings with an explicit owner, disposition, and review date. Only apply a replacement when an authoritative saved import or alias provides an exact, manager-reviewable target.