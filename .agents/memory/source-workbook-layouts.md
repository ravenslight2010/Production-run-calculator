---
name: retained source workbook layouts
description: Deterministic source audits must account for several retained Excel formula-table layouts.
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