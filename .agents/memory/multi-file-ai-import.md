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

## Workbook flatten cap must track the server cap (silent-truncation trap)
The client flattens each Excel workbook with `gridsToPromptText` (shared
`@workspace/spec-import`), whose `DEFAULT_LIMITS.maxTotalChars` bounds the text
sent per file. If this client cap is well below the server's
`MAX_WORKBOOK_CHARS` (parse-spec-sheet route), large/multi-sheet workbooks are
truncated client-side ("… (truncated)") BEFORE the AI sees them — the user just
sees "it didn't get everything," with no error. Keep the client cap just under
the server cap (currently 56k client vs 60k server) and raise both together if
more capacity is needed. The AI output side has a matching trap:
`max_completion_tokens` on the parse route must be large enough that a big parse
result isn't cut into invalid JSON (truncated JSON → JSON.parse fail → that file
yields nothing). Both apps call `gridsToPromptText(grids)` with no overrides, so
raising the lib defaults keeps web+mobile at parity automatically.

## Cross-file collisions must merge field-level, never wholesale last-wins
When two files in one batch mention the same brand+flavor profile or the same
kind+name recipe, `mergeParsedSpecImports` merges FIELD-LEVEL: a later file only
overrides fields it actually states; empty applicator/pepperoni arrays mean
"not stated" (earlier slots kept); recipe brand/flavor ties are UNIONED (incl.
flavorless singular brands folded into brandAnchors).
**Why:** wholesale later-wins silently dropped the earlier file's fields and
recipe→profile ties — users saw multi-file imports "mixing things up."
**How to apply:** any new ParsedProfile/ParsedRecipe field must survive this
merge; explicit "clear" semantics would need a sentinel, not an empty array.
