---
name: Low-stock reorder list
description: Warehouse "Reorder Now" advisory card flagging inventory at/below reorder threshold, web+mobile parity.
---

# Low-stock reorder list ("Reorder Now")

Advisory-only warehouse card on BOTH apps flagging inventory items at/below their
reorder threshold, with a suggested reorder quantity. Math is centralized in
`@workspace/inventory-math` (`computeReorderList`).

## Key decisions (the non-obvious parts)
- **Threshold 0 means "no reorder point"** and is always excluded — matches
  `isLowStock`. Only `reorderThreshold > 0` items are ever flagged.
- **Exact-tie suggests 1, not 0.** `suggestedQty = max(1, ceil(threshold -
  projectedOnHand - EPS))`, EPS=1e-6, so an item sitting exactly at threshold
  still produces an actionable quantity.
- **Demand basis = UPCOMING (today-or-later) SCHEDULED runs only — never active
  runs.**
  - **Why:** active-run consumption is already drawn down from on-hand;
    counting it again double-subtracts. Past scheduled runs would inflate demand.
  - **How to apply:** both apps must filter scheduled dates to `>= today` before
    aggregating demand. This mirrors the transfer-warning card's basis, so the
    two features can't disagree. A past-date leak here is a silent parity bug
    (web filters via `scheduledDays`; mobile must use the same filtered set, not
    raw `Object.entries(scheduled)`).
