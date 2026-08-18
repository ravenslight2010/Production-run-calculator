---
name: Spec-import scale verification harness
description: Real-AI harnesses that verify large spec imports survive chunking after model changes; chunk-limit calibration rules and gotchas.
---

# Spec-import scale verification harness

## Why it exists
The spec importer chunks large workbooks into multiple AI calls. The per-chunk
limit (`DEFAULT_LIMITS.maxTotalChars` in `lib/spec-import`) and the total-chunk
cap (`DEFAULT_MAX_PROMPT_CHUNKS` in the same file) must both be calibrated to the
active model or imports silently drop data — no error, just missing profiles.

**Run both harnesses after any AI model change or prompt rewrite.**

## The two harnesses
- `scripts/src/verify-large-spec-import.mts` — end-to-end real-AI check at
  production scale (30×8 = 240 profiles, 90 recipes). Needs API server + a
  manager account (`VERIFY_USERNAME` / `VERIFY_PASSWORD`). Takes 25-35 min at
  the current 4k limit (12-15 AI calls, one 65 s throttle pause at call 8).
  Cannot run inside a 5-min shell; use a long-lived process or workflow.
- `artifacts/api-server/scripts/e2e-spec-roundtrip.ts` — smaller AI stress test
  (qualifier brands, xlsx round-trip, known-sauce grounding SCENARIO 2).
  Last verified: 2026-08-18, gemini-2.5-flash, all 14 checks passed.

## Current calibrated limits (gemini-2.5-flash — verified 2026-08-18)
- **`maxTotalChars` = 4000** — model self-truncates ("sampled for brevity") at
  8k when a chunk mixes 64+ profiles with any recipes, and unit-converts lbs÷16
  when dense profile context precedes recipe rows. 4k keeps each chunk focused.
- **`DEFAULT_MAX_PROMPT_CHUNKS` = 32** — production cap must exceed the chunks
  that the full 30×8 workbook produces at 4k (~12-15). Old cap of 8 silently
  dropped rows 9+ for large imports.
- **`max_completion_tokens` = 65 536** on `/ai/parse-spec-sheet` — unchanged.
- **`maxProfiles` = 400** — unchanged; 4k chunks never approach this.
- **`SPEC_PARSE_VERSION`** — bump whenever any of the above change, or prompt
  rewrites land. Stale cached parses resurrect wrong data.
- **No `thinkingConfig`** — gemini-2.5-flash does NOT support `thinkingLevel`;
  the config block was removed from `client.ts`. Former Gemini 3.x note about
  `thinkingBudget: 0` fallback no longer applies.

**Why:** a repeatable check is the only defense against "model changed, big
imports quietly drop data." The harness has caught real loss on every
calibration run.

## Calibration failure modes
- **Self-truncation**: model returns partial results, citing "brevity" or
  "effort". Symptom: MISSING PROFILE failures. Fix: reduce `maxTotalChars`.
- **Unit conversion (lbs÷16)**: model treats lbs values as oz when dense profile
  context precedes recipe rows. Symptom: WRONG LBS (e.g. 50 → 3.125). Fix:
  reduce `maxTotalChars` so profiles and recipes land in separate chunks.
- **Empty JSON**: model truncates mid-reply. Harness retries up to 3×; one flake
  ≠ a systematic regression. Still empty after 3× = reduce limit.
- **Chunk cap overflow**: `droppedRows > 0`. Fix: raise `DEFAULT_MAX_PROMPT_CHUNKS`
  and re-run the harness to confirm zero dropped rows.

## Harness data must use realistic ingredient weights
Ingredient weights in the harness `buildDataset()` must match real-world orders
of magnitude (Flour ~50 lbs, Water ~28 lbs, Yeast ~0.5-2 lbs, Salt ~1.5 lbs).
Unrealistic values (e.g. 10-22 lbs of Yeast) trigger model grounding that
divides all weights by 16 to "correct" them from oz to lbs.

## Deterministic CI guard (no AI required)
`lib/spec-export/src/prompt-roundtrip.test.ts` (run via `test:spec-export`)
round-trips the full 30×8 dataset through export → chunk → prompt-text and
asserts: zero string loss, no dropped rows, chunk count ≤ `DEFAULT_MAX_PROMPT_CHUNKS`.
This catches cell-clamp and chunk-cap regressions before any AI call.

## Other gotchas
- Rate limit: 10 req/min/user; harness throttles at 8/min, sleeps 65 s on 429.
- Modelfarm proxy (`AI_INTEGRATIONS_GEMINI_BASE_URL`) can return 502 during
  Replit platform outages — distinguish from model-limit failures by checking
  whether the error is pre-parse (502) or post-parse (missing profiles/recipes).
- Fresh sign-up only works as the DB's FIRST user; otherwise grant manager role
  via `user_roles` directly or pass existing manager creds.
