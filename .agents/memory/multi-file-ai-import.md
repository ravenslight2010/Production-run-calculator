---
name: Multi-file / multi-image AI import
description: Conventions for batching multiple files/images through AI import paths (spec sheets, photo intake) at web+mobile parity.
---

Spec-sheet import and photo stock-intake both accept multiple files/images at once on web AND mobile.

Rules that must hold for any batched AI import:
- **One AI call per file/image, run SEQUENTIALLY** (a for-loop awaiting each), never `Promise.all` over the AI calls — the endpoints have cost/rate guards and a shared cost-cap limiter.
- **Per-file reads must be fault-tolerant.** Never `Promise.all(files.map(read))` raw — one bad file rejects the whole batch. Wrap each read in `.catch()` (return empty buffer/grids/null), filter/skip failures, and only fail if EVERY file failed.
- **Results are combined, not clobbered:** spec import merges parsed results via the pure `mergeParsedSpecImports` (dedupe profiles by brand|flavor, recipes by kind|name, last-wins, join notes); photo intake ACCUMULATES review rows (`setRows(rs => [...rs, ...next])`) so per-row confirm still works.
- **Cap the count** (`MAX_SPEC_IMPORT_FILES = 10`, shared in each app's specImport glue).
- **Progress UI** keyed on `{done,total}` state, only shown when `total > 1` ("Reading file X of Y…" / "Analyzing photo X of Y…").
- **429 during a photo batch breaks the loop** (stop hammering) and surfaces retryAfter; other per-item errors are surfaced but the loop continues.

**Why:** strict web+mobile parity (replit.md) + the AI endpoints are rate/cost limited, so an all-or-nothing batch both violates "one bad input shouldn't sink the batch" and risks tripping the limiter.

**How to apply:** when extending any AI import to more inputs, mirror this shape in BOTH apps; camera capture (single shot) and the quality-check photo card intentionally stay single-image.
