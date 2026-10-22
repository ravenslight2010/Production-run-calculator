# Cheese source-to-live reconciliation — 2026-08-26

This is the reviewed reconciliation matrix for the cheese findings in
`source-comparison-2026-08-26.json`. It is intentionally separate from the
immutable production snapshot.

## Evidence boundary

- Source comparison: `source-comparison-2026-08-26.json`
- Production snapshot: `production-snapshot-2026-08-26.json`
- Snapshot captured: `2026-08-26T00:21:27.339Z`
- Snapshot SHA-256: `4bff312e8176dc5333a2a5982798ea9f9bb951bb50409bb9affbd89c3407e9b6`
- Comparison SHA-256: `60acb840e373ec59c9d346e48a3b5a4ffd639bfabe8b61db7679b81cb2e69db9`
- Source manifest SHA-256: `c4241480ebf3ccda8a03ce3565fea78f68063f2531a9d20902619a8e3140cf8f`

## Review decision

The matrix approves **naming links for a future manager-confirmed cheese
re-import**, not silent production mutation. A link is listed only when the
source and target have the same positive per-batch component quantities after
conservative ingredient-label normalization. Brand prefixes, shorthand,
customer labels, and the workbook's explicit “same as” note are treated as
naming drift, not as permission to delete a row.

No production rows, aliases, component rows, or deletions were written while
this matrix was prepared. The production-write gate remains
`blocked-until-explicit-manager-approval`; no deletion is approved.

## Summary

| Finding | Result |
|---|---:|
| Distinct source names without an exact live-name match | 32 |
| Source records reviewed | 59 |
| Formula-preserving source → live links | 58 |
| Source records held for manager review | 1 |
| Live-only rows retained for review/no deletion | 16 |
| Exact-name recipes with label-only component differences | 7 |
| Component rows that need to be added | 0 |
| Production changes applied | 0 |

The 58 paired live-only rows are not deletions. They are the live records
identified by the matrix as the target of source naming drift. The remaining 16
live-only rows remain retained and review-only because the source comparison
does not establish that they are duplicates.

## Approved source-to-live naming matrix

| Source tab | Source blend | Live recipe ID | Live blend | Decision |
|---|---|---|---|---|
| Basha's Original | Whole Mozzarella Cheese Mix | cheese:basha-s-original:whole-mozzarella-cheese-mix | Basha's Original Whole Mozzarella Cheese Mix | link-on-approved-reimport |
| Basha's Ultra Thin | Five Cheese Spice Blend | cheese:basha-s-ultra-thin:five-cheese-spice-blend | Basha's Ultra Thin Five Cheese Spice Blend | link-on-approved-reimport |
| Basha's Ultra Thin | Whole Mozzarella Cheese Mix | cheese:basha-s-ultra-thin:whole-mozzarella-cheese-mix | Basha's Ultra Thin Whole Mozzarella Cheese Mix | link-on-approved-reimport |
| Corner Booth | Monterey Jack Cheese Mix | cheese:corner-booth:monterey-jack-cheese-mix | Corner Booth Monterey Jack Cheese Mix | link-on-approved-reimport |
| Corner Booth | Corner BBQ Chicken Cheese Mix | cheese:corner-booth:corner-bbq-chicken-cheese-mix | Corner Booth BBQ Chicken Cheese Mix | link-on-approved-reimport |
| Corner Booth | Whole Mozzarella Cheese Mix | cheese:corner-booth:whole-mozzarella-cheese-mix | Corner Booth Whole Mozzarella Cheese Mix | link-on-approved-reimport |
| FSD 7" | Lucia's Americano Cheese Mix | cheese:fsd-7:lucia-s-americano-cheese-mix | FSD 7" Breakfast Cheese Mix | link-on-approved-reimport |
| Four Hands | 4Hands Seven Cheese Mix | cheese:four-hands:4hands-seven-cheese-mix | Four Hands Seven Cheese Mix | link-on-approved-reimport |
| Four Hands | 4Hands Pizella Cheese | cheese:four-hands:4hands-pizella-cheese | Four Hands Pizella Cheese | link-on-approved-reimport |
| Four Hands | 4Hands Chicken Bacon Club Cheese Mix | cheese:four-hands:4hands-chicken-bacon-club-cheese-mix | Four Hands Chicken Bacon Club Cheese Mix | link-on-approved-reimport |
| Four Hands | Cheeseburger Cheese Mix | cheese:four-hands:cheeseburger-cheese-mix | Four Hands Cheeseburger Cheese Mix | link-on-approved-reimport |
| Four Hands | 4Hands Meat Cheese Mix | cheese:four-hands:4hands-meat-cheese-mix | Four Hands Meat Cheese Mix | link-on-approved-reimport |
| Four Hands | 4Hands Sugarfire Chicken Cheese Mix | cheese:four-hands:4hands-sugarfire-chicken-cheese-mix | Four Hands Sugarfire Chicken Cheese Mix | link-on-approved-reimport |
| Four Hands | Gyro Cheese Mix | cheese:four-hands:gyro-cheese-mix | Four Hands Gyro Cheese Mix | link-on-approved-reimport |
| Four Hands | Red Hot Cheese Mix | cheese:four-hands:red-hot-cheese-mix | Four Hands Red Hot Cheese Mix | link-on-approved-reimport |
| Four Hands | Whole Mozzarella Cheese Mix | cheese:four-hands:whole-mozzarella-cheese-mix | Four Hands Whole Mozzarella Cheese Mix | link-on-approved-reimport |
| Hannaford | Hannaford's Chicken Bacon Club Cheese Mix | cheese:hannaford:hannaford-s-chicken-bacon-club-cheese-mix | Hannaford Chicken Bacon Club Cheese Mix | link-on-approved-reimport |
| Hannaford | Monterey Jack Cheese Mix | cheese:hannaford:monterey-jack-cheese-mix | Hannaford Monterey Jack Cheese Mix | link-on-approved-reimport |
| Hannaford | 4 Cheese with Sweet & Spicy Chili Sauce | cheese:spec:hannaford-s-spicy-4cheese-mix | Hannaford Spicy 4Cheese Mix | link-on-approved-reimport |
| Hannaford | Lowes/Hannaford Five Cheese Mix | cheese:hannaford:lowes-hannaford-five-cheese-mix | Hannaford Five Cheese Mix | link-on-approved-reimport |
| Hannaford | Five Cheese Spice Blend | cheese:hannaford:five-cheese-spice-blend | Hannaford Five Cheese Spice Blend | link-on-approved-reimport |
| Hannaford | Skim Mozzarella Cheese Mix | cheese:hannaford:skim-mozzarella-cheese-mix | Hannaford Skim Mozzarella Cheese Mix | link-on-approved-reimport |
| Hannaford | Spinach Goat Cheese Mix | cheese:hannaford:spinach-goat-cheese-mix | Hannaford Spinach Goat Cheese Mix | link-on-approved-reimport |
| Lowe | Five Cheese Spice Blend | cheese:lowe:five-cheese-spice-blend | Lowe's Five Cheese Spice Blend | link-on-approved-reimport |
| Lowe | Red Hot Cheese Mix | cheese:lowe:red-hot-cheese-mix | Lowe's Red Hot Cheese Mix | link-on-approved-reimport |
| Lowe | Lowes/Hannaford Five Cheese Mix | cheese:lowe:lowes-hannaford-five-cheese-mix | Lowe's Five Cheese Mix | link-on-approved-reimport |
| Lowe | Monterey Jack Cheese Mix | cheese:lowe:monterey-jack-cheese-mix | Lowe's Monterey Jack Cheese Mix | link-on-approved-reimport |
| Lowe | Cheeseburger Cheese Mix | cheese:lowe:cheeseburger-cheese-mix | Lowe's Cheeseburger Cheese Mix | link-on-approved-reimport |
| Lowe | Skim Mozzarella Cheese Mix | cheese:lowe:skim-mozzarella-cheese-mix | Lowe's Skim Mozzarella Cheese Mix | link-on-approved-reimport |
| Lowe | Lucia's Caribbean Cheese Mix | cheese:lowe:lucia-s-caribbean-cheese-mix | Lowe's Caribbean Cheese Mix | link-on-approved-reimport |
| Lowe's 7" | Five Cheese Spice Blend | cheese:lowe-s-7:five-cheese-spice-blend | Lowe's 7" Five Cheese Spice Blend | link-on-approved-reimport |
| Lucia Improved | Lucia's Monterey Jack Cheese Mix | cheese:lucia-improved:lucia-s-monterey-jack-cheese-mix | Lucia's New & Improved Monterey Jack Cheese Mix | link-on-approved-reimport |
| Lucia Improved | Lucia's 6 Cheese Mix | cheese:lucia-improved:lucia-s-6-cheese-mix | Lucia's New & Improved 6 Cheese Mix | link-on-approved-reimport |
| Lucia Improved | Lucia's Standard Cheese Mix | cheese:lucia-improved:lucia-s-standard-cheese-mix | Lucia's New & Improved Standard Cheese Mix | link-on-approved-reimport |
| Lucia Improved | Lucia's Pepperoni Cheese Mix | cheese:lucia-improved:lucia-s-pepperoni-cheese-mix | Lucia's New & Improved Pepperoni Cheese Mix | link-on-approved-reimport |
| Lucia Improved | Lucia's Cheeseburger Cheese Mix | cheese:lucia-improved:lucia-s-cheeseburger-cheese-mix | Lucia's New & Improved Cheeseburger Cheese Mix | link-on-approved-reimport |
| Lucia Craft | Lucia's Club Cheese Mix | cheese:lucia-craft:lucia-s-club-cheese-mix | Lucia's Craft Club Cheese Mix | link-on-approved-reimport |
| Lucia Craft | Lucia's Spinach Cheese Mix | cheese:lucia-craft:lucia-s-spinach-cheese-mix | Lucia's Craft Spinach Cheese Mix | link-on-approved-reimport |
| Lucia Craft | Red Hot Cheese Mix | cheese:spec:lucia-s-craft-red-hot-cheese-mix | Lucia's Craft Red Hot Cheese Mix | link-on-approved-reimport |
| Lucia Craft | Lucia's Craft Cheese Mix | cheese:lucia-s-craft:lucia-s-craft-cheese-mix | Lucia's Crft Bratwurst Cheese Mix | link-on-approved-reimport |
| Lucia Craft | Lucia's Cheeseburger Cheese Mix | cheese:lucia-craft:lucia-s-cheeseburger-cheese-mix | Lucia's Craft Cheeseburger Cheese Mix | link-on-approved-reimport |
| Lucia Craft | Lucia's Caribbean Cheese Mix | cheese:lucia-craft:lucia-s-caribbean-cheese-mix | Lucia's Craft Caribbean Cheese Mix | link-on-approved-reimport |
| Lucia Craft | Whole Mozzarella Cheese Mix | cheese:lucia-craft-new:whole-mozzarella-cheese-mix | Lucia's Craft Whole Mozzarella Cheese Mix | link-on-approved-reimport |
| Lucia Morning Melts | Lucia's Americano Cheese Mix | cheese:lucia-morning-melts:lucia-s-americano-cheese-mix | Lucia's Morning Melts Americano Cheese Mix | link-on-approved-reimport |
| Lucia Morning Melts | Lucia's Italiano Cheese Mix | cheese:lucia-morning-melts:lucia-s-italiano-cheese-mix | Lucia's Morning Melts Italiano Cheese Mix | link-on-approved-reimport |
| Lucia Morning Melts | Lucia's Mexicano Cheese Mix | cheese:lucia-morning-melts:lucia-s-mexicano-cheese-mix | Lucia's Morning Melts Mexicano Cheese Mix | link-on-approved-reimport |
| Lucia Morning Melts | Lucia's Parisian Cheese Mix | cheese:lucia-morning-melts:lucia-s-parisian-cheese-mix | Lucia's Morning Melts Parisian Cheese Mix | link-on-approved-reimport |
| Lucia's Pinsa (Proof) | Whole Mozzarella Cheese Mix | cheese:lucia-s-pinsa-proof:whole-mozzarella-cheese-mix | Lucia's Pinsa Whole Mozzarella Cheese Mix | link-on-approved-reimport |
| Mauro | Mozzarella Cheese Mix | cheese:mauro:mozzarella-cheese-mix | Mauro Mozzarella Cheese Mix | link-on-approved-reimport |
| Mystic | Mozzarella Cheese Mix | cheese:mystic:mozzarella-cheese-mix | Mystic Mozzarella Cheese Mix | link-on-approved-reimport |
| Medulla 12x16 | Mozzarella Cheese Mix | cheese:medulla-12x16:mozzarella-cheese-mix | Medulla 12x16 Mozzarella Cheese Mix | link-on-approved-reimport |
| Nob Hill Craft | Monterey Jack Cheese Mix | cheese:nob-hill-craft:monterey-jack-cheese-mix | Nob Hill Craft Monterey Jack Cheese Mix | link-on-approved-reimport |
| Price Chopper | Monterey Jack Cheese Mix | cheese:price-chopper:monterey-jack-cheese-mix | Price Chopper Monterey Jack Cheese Mix | link-on-approved-reimport |
| Price Chopper | Skim Mozzarella Cheese Mix | cheese:price-chopper:skim-mozzarella-cheese-mix | Price Chopper Skim Mozzarella Cheese Mix | link-on-approved-reimport |
| SMD | Mozzarella Cheese Mix | cheese:smd:mozzarella-cheese-mix | SMD Mozzarella Cheese Mix | link-on-approved-reimport |
| SMD | SMD Supreme Cheese Mix (same as Lowe's Grilled Veggie Cheese Mix) | cheese:spec:show-me-dough-smd-supreme-cheese-mix-same-as-lowe-s-grilled-veggie-cheese-mix | SMD Supreme Cheese Mix | link-on-approved-reimport |
| Vita | Mozzarella Cheese Mix | cheese:vita:mozzarella-cheese-mix | Vita Mozzarella Cheese Mix | link-on-approved-reimport |
| Vocelli's | Whole Mozzarella Cheese Mix | cheese:vocelli-s:whole-mozzarella-cheese-mix | Vocelli's Whole Mozzarella Cheese Mix | link-on-approved-reimport |
| Price Chopper | Hannaford's Chicken Bacon Club Cheese Mix | — | — | **hold** — source is 16+16 Part Skim; live candidate is 20+20 Skim; formula conflict |

## Missing component findings

All seven exact-name recipes in the source comparison have source labels that
are either equivalent to an existing live component label or explicitly a
zero-value reference row. No component row is approved for insertion.

| Recipe | Source component label | Live equivalent | Decision |
|---|---|---|---|
| Edwardo's Parmesan Oregano Mix | Parmesan Grated | Parmesan - Grated | canonical-equivalent-no-addition |
| Edwardo's Parmesan Oregano Mix | Oregano Flake | Oregano Flakes | canonical-equivalent-no-addition |
| Edwardo's Parmesan Oregano Mix | NO Cellulose = 0 | — | source-zero-row-no-addition |
| Edwardo's Bacon Spinach Mix | Spinach - Fresh | Fresh Spinach (broken up) | canonical-equivalent-no-addition |
| Edwardo's Mozzarella Cheese Mix | Part Skim Mozzarella Cheese | Part Skim Mozzarella | canonical-equivalent-no-addition |
| Mystic 50/50 Cheese Mix | Whole Milk Mozzarella | Whole Mozzarella | canonical-equivalent-no-addition |
| Member's Selection (PriceSmart) Color Cheese Mix | Whole Milk Mozzarella | Whole Mozzarella | canonical-equivalent-no-addition |
| Vita Red Pepper Cheese Mix | Fresh Spinach | Fresh Spinach (broken up) | canonical-equivalent-no-addition |
| Vocelli's Garlic Spinaci Cheese Mix | Fresh Spinach | Fresh Spinach (broken up) | canonical-equivalent-no-addition |
| Vocelli's Garlic Spinaci Cheese Mix | Feta | Feta Cheese | canonical-equivalent-no-addition |
| Vocelli's Garlic Spinaci Cheese Mix | Cow's Romano | Romano - Cow | canonical-equivalent-no-addition |

The comparison's seven recipe-level findings therefore contain eleven
component-label rows: ten canonical equivalences and one zero-row no-op.

## Retention and before/after record

| State | Record |
|---|---|
| Before | 129 cheese rows from the retained production snapshot, captured at `2026-08-26T00:21:27.339Z` |
| Approved after | 58 future re-import link decisions; no direct row mutations |
| Applied after | Identical to before; 0 production writes |
| Deletions | None approved or performed |
| Reversal | The retained snapshot plus this matrix is the before/after record; any later manager-approved import must retain its own server/import history batch |

The Price Chopper conflict, the 16 unpaired live-only rows, and any future
component quantity change require an explicit manager decision before a
production edit. Do not use this report as permission to bulk-delete live-only
rows.