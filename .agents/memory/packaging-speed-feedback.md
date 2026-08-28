---
name: Packaging speed feedback scope
description: The web packaging speed correction lifecycle is shared across live-tab quick checks.
---

The Packaging speed feedback lifecycle belongs at the always-mounted live provider boundary, not inside the Packaging tab component. Packaging, Dough, and Sauce can all change the same packed skid/case total, so each must report the same signed correction delta; feedback may still be rendered and accepted from the Packaging surface.

**Why:** Dough and Sauce quick checks remain mounted separately from the Packaging tab, and tab-local bookkeeping loses correction evidence when operators switch surfaces.

**How to apply:** Preserve the existing manual persistence, auto-track suppression, and eligibility rules. Any new web control that changes packed skid/case totals should call the provider's shared correction action after applying its normal persistence path.