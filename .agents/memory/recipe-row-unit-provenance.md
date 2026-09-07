---
name: Recipe row unit provenance
description: Rules for carrying uncertain source-unit labels without changing imported recipe values.
---

Recipe row unit labels are provenance only: never convert, rescale, or reinterpret raw recipe values from them. Missing or unclear labels remain advisory review concerns.

**Why:** Workbook layouts are not reliable enough to infer units from numeric size, and a unit retained from a different row set can make replacement values look more certain than they are.

Manager confirmation is separate from the source-reported label and applies to
the whole selected recipe row set. It records `lbs` or `oz` without replacing
the original label.

**How to apply:** Whenever recipe rows are sanitized, merged, cached, or reopened, keep the label and any manager confirmation paired with the selected source rows. If replacement rows omit either field, clear the older metadata and surface uncertainty to the manager.