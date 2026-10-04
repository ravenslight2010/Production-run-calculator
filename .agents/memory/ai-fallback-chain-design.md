---
name: AI fallback chain design (Gemini-only, local routing rejected)
description: why the local AI adapter is not merged, and how the within-Gemini model fallback chain is adopted onto the resilient adapter instead.
---

# AI routing: one provider, several models

**Status:** implemented 2026-10-04. The local adapter stays rejected; only the ladder landed.

Two unmerged branches carry AI routing work. They are **not** a merge of equals.
One is already settled by evidence; the other supplies the mechanism.

## The local adapter is rejected — do not merge it

`origin/feat/local-ai-adapter` (= `origin/test-merge/replit-main`) adds
`LOCAL_AI_BASE_URL` routing to an OpenAI-compatible server. `docs/evidence/
gated-local-ai-adapter-decision-2026-10-02.md` is a dated **no-go**, backed by
`docs/evidence/local-spec-import-benchmark-blocker-2026-10-02.md` (benchmark not
run, **0 eligible comparison cases**).

An independent re-read of that branch reproduces every defect the review named,
so the rejection stands on inspection alone:

| Review finding | Where it lives |
| --- | --- |
| "silently selected local inference from URL presence" | `models.ts` reads `process.env` at **module load** (`GEMINI_FULL`, `AI_MODELS` are top-level consts), so routing is fixed at import and `LOCAL_AI_BASE_URL` needs no opt-in |
| "broadly classified arbitrary `Error` values as fallback-eligible" | `isTransportError()` ends in `return ... \|\| err instanceof Error` — every plain `Error` is treated as transport-worthy |
| "did not bound all request lifetimes consistently" | `abortable()` only arms when `signal`/`timeoutMs` is passed; no default budget on the local path |
| "counted stream creation as success before stream consumption" | deletes the `deferStreamCleanup` machinery and does `releaseCircuit(mode,"success")` as soon as `generateContentStream` resolves |

It also reverts this branch's readiness contract: it drops the `warning`
`CheckStatus` and `capabilities.ai`, and flips the
`health.test.ts` case where `LOCAL_AI_BASE_URL` alone must **not** report AI
configured.

**Consequence:** `LOCAL_AI_BASE_URL` stays inert. Do not add a provider switch,
and do not treat "add an AI to the app" as a reason to revisit it — the reopen
path is an access-controlled verified gold set plus an approved endpoint and
model identity, per the blocker report.

## Adopt the fallback chain from the model-chain branch

`origin/codex/fix-import-model-fallback` is a pure Gemini change (zero
`LOCAL_AI` references) and is **not** covered by the no-go. What we want from
it is the mechanism: an ordered model ladder so a provider transient moves to
the next model instead of 502-ing the route or returning a hollow parse.

Its client is an **older base** (333 lines, no timeout/circuit/metrics), so this
is *not* a cherry-pick — the chain logic is lifted onto `createGeminiResilient`.

### Keep

- `aiModelFallbacks()` / `modelChain(primary)` in `src/models.ts`, and the
  `AI_MODEL_FALLBACKS` env override.
- `isFallbackWorthyError()` — 404/429/500/502/503/504 plus capacity/quota
  phrasing; never on abort, timeout, or cancellation.
- `isBlockedResponse()` — a SAFETY block returns `null` content and does **not**
  advance the chain (retrying a safety block on another model is noise).
- Empty/whitespace content advances the chain. This is the "3.x flash burned
  the whole output budget on hidden thoughts and returned HTTP 200 with no text"
  failure mode; the chain is the backstop for it.
- `servedByFallback()` in `artifacts/api-server/src/routes/ai.ts` — never file a
  fallback model's output under the requested model's cache fingerprint.

### Drop or correct

- **Do not bump the primary to `gemini-3.8-flash`.** It is unverified against
  this account's key, and the benchmark froze an evaluation identity
  (`SPEC_PARSE_VERSION` 41, system-prompt SHA-256, 51-workbook corpus) that a
  primary swap invalidates. Keep `gemini-3.6-flash`.
- **Fix the fallback list.** `gemini-3.5-flash-lite` does not exist in
  `@google/genai` 2.25.0 (the SDK ships `gemini-3.5-flash` and
  `gemini-3.1-flash-lite`), so it would spend a chain attempt on a guaranteed
  404. Default to `["gemini-3.5-flash", "gemini-3.1-flash-lite"]`.
- **Do not take `SPEC_PARSE_VERSION` 40 → 41**; this branch is already at 41
  via `lib/spec-import`.
- `AI_MODELS` must stay **lazy**. That branch binds env at module load, which
  breaks per-test env control and the `pickModel` mock contract.

## How the chain composes with the resilience layer

The two branches each solved half of the stream lifecycle and must not both be
applied:

- **Fallback happens at stream setup only.** Once the first chunk reaches the
  consumer a partial answer is already on screen, so iteration errors propagate.
- **Telemetry stays deferred.** Keep `deferStreamCleanup` / `finishStream`: the
  circuit must not be released as success until the iterator completes, and an
  abandoned stream records `cancelled`, not `success`. The model-chain branch's
  `signalHandedOff` and this branch's `finishStream` do the same job — keep one.
- **The circuit counts chain exhaustions, not model attempts.** The breaker
  threshold is 3 consecutive failures; counting each model would open the circuit
  partway down the ladder and the fallbacks would never be reached.
- **Report the serving model.** `ChatResponse` gains `model`, so `ai.ts` can
  skip caching when a fallback served the call.
- **`retryCount` in metrics** becomes the chain index, not a per-model counter.

## What deliberately stays unchanged

- Readiness remains Gemini-only; `LOCAL_AI_BASE_URL` never reports AI configured.
- `thinkingConfig: { thinkingLevel: LOW }` stays — it is the documented fix for
  thinking-token starvation, and the empty-content retry is a backstop, not a
  replacement.
- `SPEC_PARSE_VERSION` stays 41 so the frozen evaluation identity holds.

## Verify with

`artifacts/api-server/src/lib/geminiAdapter.test.ts` (chain advance, safety-block
short-circuit, no-fallback-on-abort, deferred stream telemetry),
`artifacts/api-server/src/routes/health.test.ts` (`LOCAL_AI_BASE_URL` inert), and
`artifacts/api-server/src/routes/costLimit.integration.test.ts` (cache skipping).
