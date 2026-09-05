---
name: Shell lint inventory
description: The scripts package keeps an explicit ShellCheck list while guarding it against drift.
---

The maintained shell scripts in `scripts/src` and top-level `scripts/` must
stay explicitly listed in the `check:shell` command. Fixture-only or generated
shell files are the only allowed exclusions, and must use the documented
fixtures directory or suffix convention. Shell files under other package or
skill roots are owned by those roots' policies rather than this inventory.

**Why:** The explicit list prevents generated or fixture files from entering
lint accidentally, while the drift guard prevents a new validation script from
silently bypassing ShellCheck.

**How to apply:** When adding or removing a maintained shell file in either
scripts boundary, update `scripts/package.json` and run the scripts package
test flow. Do not broaden the exclusion rule without a focused review.