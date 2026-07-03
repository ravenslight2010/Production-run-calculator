---
name: Spec-import scale verification harness
description: Durable real-AI harnesses that verify huge spec imports survive chunking after AI model changes; plus the prompt cell-clamp wrapping rule for exported target rows.
---

# Spec-import scale verification harness

The spec importer's per-chunk limits are tuned EMPIRICALLY to the current AI
model (gemini-3.1-pro-preview): 16k-char chunk budget
(`DEFAULT_LIMITS.maxTotalChars` in `lib/spec-import`), 65,536
`max_completion_tokens` on `/ai/parse-spec-sheet`, sanitizer `maxProfiles` 400.
If `AI_MODELS`/`pickModel` is ever repointed, these can silently become wrong —
the failure mode is an import that "succeeds" but loses data (truncated output
→ non-JSON → empty, or valid-but-EMPTY JSON).

**Two committed harnesses — run BOTH after any AI model change:**
- `scripts/src/verify-large-spec-import.mts` (`pnpm --filter @workspace/scripts
  run verify-large-spec-import`) — SIZE: generates a 30-brand × 8-flavor export
  via `buildSpecExportGrids`, chunks with `splitGridsForPrompt`, sends every
  chunk through the REAL `/ai/parse-spec-sheet`, merges with
  `mergeParsedSpecImports`, asserts zero loss (profiles, recipes, rows,
  targets). Needs the API server up + a manager account
  (`VERIFY_USERNAME`/`VERIFY_PASSWORD`). Last full pass: 2026-07-03 (also
  live-verified recipe-name grounding: paraphrase "Ultra Thin Dough Recipe" +
  punctuation variant "Aldos Sauce" snapped to known names, partial-overlap
  name kept + flagged as likely duplicate, genuinely new recipe untouched).
- `artifacts/api-server/scripts/e2e-spec-roundtrip.ts` — parse-RULE stress
  (small dataset, xlsx round-trip, qualifier brands etc.). Its deterministic
  xlsx write→read→grid half is now also guarded in CI without AI:
  `lib/spec-export/src/xlsx-roundtrip.test.ts` (test:spec-export workflow); the
  paid harness remains the only check for the AI-parse half. Also carries
  SCENARIO 2 (known-sauce grounding): a sheet abbreviating ready-made sauces
  the factory already has (`known.sauceNames`) must import with NO false
  "not found on the sheet" warning; a control re-sanitize WITHOUT the known
  list must warn; a scripted paraphrase must still warn/snap. Last full pass
  (2 consecutive): 2026-07-03. The model occasionally truncates JSON mid-note
  even on tiny outputs — the harness retries a malformed-JSON response up to
  3× (the real route fails safe with an empty result instead).

**Why:** a repeatable check is the only defense against "model changed, big
imports quietly drop data"; the harness caught a real loss on its first run
(see below).

## Exported target rows must wrap under the prompt cell clamp

`gridsToPromptText`/`splitGridsForPrompt` clamp every CELL to
`PROMPT_MAX_CELL_CHARS` (80, exported from `@workspace/spec-import`). The
exporter's `"Brand: flavor, flavor…"` recipe-target row is ONE cell — with ~8
flavors it exceeded 80 chars and the clamp silently cut trailing flavors
("Veggie", "BBQ Chicken"), so re-import lost those targets and the AI guessed
them back from fragments. Fix: `buildRecipeGrid` wraps a brand's flavors across
multiple `"Brand: f1, f2"` rows, each under the clamp (importer unions repeated
brand rows). **How to apply:** any NEW exporter output destined for the AI
prompt path must keep every single cell under `PROMPT_MAX_CELL_CHARS` or wrap.
This invariant is now guarded deterministically in CI (no AI):
`lib/spec-export/src/prompt-roundtrip.test.ts` round-trips the harness's 30×8
dataset through export → chunk → prompt-text and asserts zero string loss —
run via the `test:spec-export` workflow. The real-AI harnesses remain the only
check for MODEL-side limits (output budget, empty-JSON flakiness).

## Harness gotchas
- Route rate limit is 10 req/min/user — the harness throttles at 8/min and
  sleeps 65s on 429.
- A single chunk occasionally returns empty on the first try (truncated/flaky
  model response); the harness retries a chunk up to 3× before failing, so one
  flake ≠ a systematic limit regression. Systematic = still empty after
  retries.
- Fresh sign-up only works as the DB's FIRST user (bootstrap manager);
  otherwise promote via `user_roles.role='manager'` or pass manager creds.
