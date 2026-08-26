---
name: Source-audit report versions
description: Compatibility boundary for persisted source-library comparison reports.
---

Persisted source-audit reports use a version-dispatched read path and a separate current-version write check. Retain a validator for every supported historical version when the report contract evolves; newly generated reports must still validate against only the current version.

**Why:** Strictly replacing the only validator on a future contract bump would make committed audit evidence unreadable, while accepting unknown versions would let reviewers misread changed fields.

**How to apply:** Add a version-specific validator to the read dispatch table before bumping the writer version, and keep generation wired to the current-version validator.