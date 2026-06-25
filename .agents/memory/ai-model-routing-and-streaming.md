---
name: AI model routing + chat streaming
description: pickModel cost/latency routing, SSE streaming for chat AI routes, and the test-mock gotcha it introduced.
---

# AI model routing (`pickModel`)

`@workspace/integrations-openai-ai-server` exports `pickModel(kind: "cheap"|"full")` (+ `AI_MODELS`). All server AI routes resolve their model through it instead of a hardcoded string.

- **cheap** = high-volume/simple classification & matching (command-classify, fill-missing, match-import, match-premix, suggest-merges).
- **full** = reasoning-heavy (optimize, ask, recipe-assistant, forecast, summary, anomalies, schedule-optimize, incident diagnosis/clustering, vision).

## Gotcha: test mocks MUST export `pickModel`
Any `vi.mock("@workspace/integrations-openai-ai-server", ...)` factory must also return `AI_MODELS` and `pickModel`, or every route that calls it throws "pickModel is not a function" → 502.

**Why:** several stale mocks returned only `{ openai }`; after routes started calling `pickModel()`, those suites broke en masse.

**How to apply:** when adding/editing such a mock, inline `const AI_MODELS = {...} as const;` inside the factory and return `{ openai, AI_MODELS, pickModel: (k="full") => AI_MODELS[k] }`. (Inline, not a hoisted top-level const — vi.mock hoisting forbids referencing outer vars.)

# Chat streaming (SSE)

`/ai/ask` and `/ai/recipe-assistant` have opt-in SSE branches gated by `Accept: text/event-stream` (shared helpers in `aiStream.ts`, emit `delta`/`done`/`error`). Non-stream JSON remains the default and the fallback.

- These two routes have NO aiReviewer second pass (streaming bypasses it by design).
- Clients (web+mobile) use a shared `postEventStream` wrapper (`requestAskStream` / `requestRecipeAssistStream`) and **must** fall back to the non-stream request on any stream failure.
- UI parity: both web `AssistantTab.tsx` and mobile `(tabs)/assistant.tsx` render a live provisional streaming bubble, then commit the final turn.
