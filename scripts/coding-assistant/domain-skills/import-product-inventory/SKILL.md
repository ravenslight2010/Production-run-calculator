---
name: import-product-inventory
description: Use when working on product import, inventory mapping, gold sets, name library, product profiles, schedule/dough/sauce/cheese/premix workbook imports, or validation rules for v1 or v2 of the production assistant.
---

# Import & Product Inventory Skill

## Purpose
Help create, validate, and improve product import flows, gold sets, name libraries, and inventory mapping across v1 (Production-run-calculator) and v2 (Lucias-production-assistant-v2) and future versions.

## When to use
- Importing schedule, dough, sauce, cheese, or premix sheets
- Building or validating gold sets
- Mapping product names / profiles
- Fixing import validation failures
- Comparing import behavior between v1 and v2

## Core rules
1. Prefer the V2 transactional / revision-safe model when both exist.
2. Never invent columns or mapping rules — read the existing parsers and tests first.
3. Gold sets must be small, representative, and include both happy-path and edge cases.
4. Always check for existing name-library / product-profile logic before adding new mapping.

## Workflow
1. Identify which version (v1 / v2 / both) and which sheet family.
2. Locate the relevant parser, validator, and any existing gold-set files.
3. Propose or update a gold set with clear expected outcomes.
4. Suggest validation rules or error messages that match existing style.
5. If changing mapping, show the before/after for the affected products.

## Output
- Concrete file paths and proposed changes
- Gold-set examples (CSV or JSON)
- List of risks or missing test coverage
