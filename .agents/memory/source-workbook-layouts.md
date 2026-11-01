---
name: retained source workbook layouts
description: Retained workbook layout guards and admission checks for synthetic fallback fixtures.
---

Retained dough and sauce workbooks are not one uniform spreadsheet format:
some use numeric cells, some annotate numeric strings, some expose multiple
batch columns, and some put the authoritative table beside the procedure or
leave an ingredient amount only in an instruction row. Formula audits should
use explicit, reviewable layout guards and fail closed when a new revision does
not match.

**Why:** Treating every workbook as a simple first-column/first-number table
either silently drops ingredients or turns headers, totals, and procedure text
into false formula findings.

**How to apply:** Keep source-file or workbook-layout mappings deterministic,
normalize amounts before comparison, and retain parser output plus dated
findings so reviewers can distinguish amount drift from ingredient/label drift.

## Synthetic fallback fixtures

Verify fallback fixtures through the real preparation/admission layer, not only
through the deterministic sub-parser. Keep invented domain labels and cited
cells coherent without copying a customer's workbook.

**Why:** A workbook that is not a supported deterministic export can still be
correctly rejected as unrelated input before AI fallback. A pure-parser check
therefore cannot prove the browser will reach review, permission guidance or
provider-failure recovery.

**How to apply:** Check actual preparation with a mocked provider and with AI
disabled. Preserve the production admission guard; fix an unrecognizable
synthetic fixture rather than broadening automatic AI eligibility to garbage.