---
name: Forecast accuracy review
description: How managers see forecast-vs-actual scoring; the canonical forecast-fact round-trip contract.
---

# Forecast accuracy (forecast vs. actual)

Managers review how past demand forecasts held up vs. actual finished runs. Surfaced as a manager-only `AccuracySection` in the Assistant tab, web + mobile parity.

## Canonical forecast-fact round-trip
- Forecasts are stored in facility memory (`@workspace/ai-memory`) domain `forecast`, key `plan:<date>`, as a **human-readable** fact (kept readable for AI grounding).
- `formatForecastFact` (record path in `ai.ts`) and `parseForecastFact` (accuracy path) are ONE canonical pair — round-trip tested. Never change one without the other.
- Parser is **tolerant of truncation** because facts are capped at `MAX_KNOWLEDGE_FACT_LEN` (600); a chopped tail must still yield the surviving products.
- Parser only accepts `plan:` keys with a valid date; it must ignore our own `accuracy:<date>` notes and other domains' keys.

**Why:** facts double as AI grounding text, so they can't be opaque JSON; the readable format is the wire format, hence the strict round-trip + truncation tolerance.

## Comparison & scoring
- Match forecast products to actuals by **normalized** (lowercase, collapsed-space) `brand + flavor` label.
- Statuses: `hit` (within `ACCURACY_HIT_TOLERANCE` = 10%), `over`, `under`, `missed` (predicted, never ran), `unexpected` (ran, never predicted).
- `caseAccuracyPct` is deterministic arithmetic on day totals (equal totals incl. 0/0 = 100; clamps to 0).
- A day is reviewed only if it was forecast AND has finished actual runs in the body history. Reviews returned newest-first.

## Endpoint shape
- `POST /ai/forecast-accuracy`, `requireRole("manager")`, **NO AI call, NO rate limit** (pure math).
- Best-effort records `accuracy:<date>` back to facility memory so the forecaster learns from misses; a write failure must never break the response.
- Pure logic lives in `artifacts/api-server/src/routes/forecastAccuracy.ts` (unit-tested separately from the route).

## Cross-day trend rollup
- The accuracy response carries a `trend` rollup (average accuracy + days scored + chronically over-/under-predicted products) alongside the per-day reviews. It is a required response field — the server ALWAYS sends it (empty defaults when nothing to score), so client types must require it too, not mirror it as optional.
- "Chronic" means a product missed in the SAME direction on at least 2 reviewed days AND that direction strictly dominated the other. Deliberately counts only the literal `over`/`under` statuses, NOT `missed`/`unexpected`, so the highlight wording ("repeatedly over/under-predicted") stays literally true. **Why:** a one-bad-day flag is noise, and folding in missed/unexpected would mislabel forecast gaps as mis-predictions.

## Feeding accuracy back into the forecaster
- `/ai/forecast` grounds its prompt in recent accuracy: it recomputes the trend on the fly via `buildForecastReviews(knowledge, body.history)` → `summarizeAccuracyTrend` → `formatAccuracyGrounding`, then passes that string as the 2nd arg of `buildForecastPrompt`. It does NOT depend on the accuracy endpoint having been called — the forecast request already carries finished history, and recorded `plan:<date>` facts live in facility memory.
- `formatAccuracyGrounding` names only the literal chronic over/under products (same posture as the trend) so the wording stays true; returns "" when nothing scored (caller skips the section). The system prompt explicitly tells the model to scale chronically-over products down / under products up.
- **Why:** the raw `accuracy:<date>` day-total facts were already in the generic memory dump but invisible to the model as calibration signal; an explicit, per-product section makes the forecaster self-correct. Still advisory — no new auto-commit.

## Client/UI parity
- Both clients reuse the SAME finished-history builder (`buildForecastHistory`) shared with the forecast input, so "actual" means identically the same thing in forecast and accuracy.
- Accuracy input is just `{nowMs, history}` — the server reads recorded forecasts itself; clients never send forecasts.
- `AccuracySection` sits next to `ForecastSection` inside the manager gate in both `AssistantTab.tsx` (web) and `assistant.tsx` (mobile).
