# Manager approval receipt — cheese reconciliation

## Decision

The formula-preserving source-to-live links in
`CHEESE-RECONCILIATION-2026-08-26.md` are approved only for the matching
manager-confirmed cheese re-import.

- **58** exact source-to-live links are approved.
- **Price Chopper — Hannaford's Chicken Bacon Club Cheese Mix** remains
  separated. The source is **16 + 16 Part Skim**; the live candidate is
  **20 + 20 Skim**.
- **No component rows** are approved for addition.
- **No rows** are approved for deletion, including the 16 live-only rows.

## Evidence and reversal boundary

This approval is bound to the evidence identified in the reconciliation:

- Audit: `2a316d7ee51e6822b1b583e5d5a3f89f4d4fb810cb8c0201f91e55fb1e942c55`
- Production snapshot:
  `4bff312e8176dc5333a2a5982798ea9f9bb951bb50409bb9affbd89c3407e9b6`
- Source workbook:
  `21432dc3c0260f578d66989830458f51c19d2524ebf0453efcf7b761e78d9878`

The retained production snapshot and the reconciliation matrix are the
before/undo record. A successful audited re-import also records the exact 58
links, the held conflict, and this evidence in import history.

## Application control

The application activates this decision only for the byte-identical reviewed
workbook. It locks the import to all 58 approved targets and blocks changed
source/pool evidence, partial writes, removals, unrelated rows, and the held
Price Chopper conflict. The only write path remains the manager-gated cheese
recipe workflow.