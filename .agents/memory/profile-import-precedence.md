---
name: Profile import precedence
description: Precedence rule for product-specific fields when shared recipes and pool defaults disagree.
---

Explicit product/profile metadata from an imported spec is authoritative over shared recipe metadata and server-pool defaults for that same import.

**Why:** Shared formulas can legitimately serve products with different doughball weights, tray counts, or applicator links. A later fallback/hydration pass can silently erase the product-specific value even when the initial profile write was correct.

**How to apply:** When adding a product-level import field, carry an explicit-source guard through every later recipe tie, variant match, pool hydration, and force-update path. Test with conflicting values at each fallback layer.