---
name: schema-and-goldsets
description: Use when designing or evolving schemas, creating gold sets for imports or QC, or ensuring data contracts stay stable across v1/v2/v3.
---

# Schema & Gold Sets Skill

## Purpose
Keep schemas and gold sets clean, versioned, and useful for both import validation and regression testing.

## When to use
- Adding columns or changing types
- Creating or updating gold sets
- Ensuring import or QC contracts stay stable
- Preparing data for multi-version work

## Core rules
1. Gold sets are small, checked-in, and cover happy path + important edge cases.
2. Schema changes must be backwards-compatible or have an explicit migration path.
3. Prefer explicit versioned contracts over implicit spreadsheet layouts.
4. Document expected outputs next to the input gold set.

## Workflow
1. Identify the contract (import sheet, QC record, inventory event, etc.).
2. Locate existing schema / types / gold sets.
3. Propose the smallest change that satisfies the new requirement.
4. Create or update a gold set with clear expected results.
5. Note any migration or dual-write needs.

## Output
- Proposed type / schema diff
- Gold-set file content
- Migration notes if needed
