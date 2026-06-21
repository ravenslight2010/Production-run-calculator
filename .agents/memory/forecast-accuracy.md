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

## Client/UI parity
- Both clients reuse the SAME finished-history builder (`buildForecastHistory`) shared with the forecast input, so "actual" means identically the same thing in forecast and accuracy.
- Accuracy input is just `{nowMs, history}` — the server reads recorded forecasts itself; clients never send forecasts.
- `AccuracySection` sits next to `ForecastSection` inside the manager gate in both `AssistantTab.tsx` (web) and `assistant.tsx` (mobile).
