---
name: Warehouse and Inventory boundary
description: Durable terminology and job boundary for warehouse preparation versus inventory records.
---

Use **Warehouse** for operational production preparation and **Inventory** for stock records and
maintenance. Keep them as separate destinations in the same responsive web application; do not
collapse them into a combined destination or add another bottom tab.

**Why:** The jobs are related but have different intent and authorization expectations. Warehouse
answers what staff should prepare for production, while Inventory answers what stock exists and
whether an authorized user may change its records.

**How to apply:** Use Warehouse consistently for the operational tab and cast display. Use Inventory
for the stock-record destination. “Stock” may remain a common noun but not a destination name.
Preserve existing capability checks and explain restricted Inventory edits before an attempt.
