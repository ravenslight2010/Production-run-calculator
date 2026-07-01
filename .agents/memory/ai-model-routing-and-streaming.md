---
name: AI model routing + chat streaming
description: pickModel cost/latency routing, the Google Gemini provider adapter, SSE streaming for chat AI routes, and the test-mock gotcha it introduced.
---

# AI provider = Google Gemini via Replit AI Integration

The AI provider is **Google Gemini** (Replit-managed AI Integration, no user API key), NOT OpenAI. `@workspace/integrations-openai-ai-server` keeps its historical name but its `openai` export is a thin **adapter** (`src/client.ts`) that preserves the `openai.chat.completions.create({model, messages, response_format, max_completion_tokens, stream?})` surface so the ~30 call sites stay unchanged, while calling `@google/genai` (`GoogleGenAI.models.generateContent` / `generateContentStream`) underneath.

**Why:** OpenAI quota ran out; the user chose Gemini. modelfarm does **NOT** support the OpenAI-compatible `/chat/completions` path (returns 400 "not supported") — you must use the native `@google/genai` SDK.

**How to apply (sharp edges):**
- Construct: `new GoogleGenAI({ apiKey: AI_INTEGRATIONS_GEMINI_API_KEY, httpOptions: { apiVersion: "", baseUrl: AI_INTEGRATIONS_GEMINI_BASE_URL } })`. Both env vars are auto-provisioned by the integration (present in workflow/bash shells, NOT in the code_execution sandbox / viewEnvVars).
- Adapter mapping lives in `src/client.ts` (read it before editing). Non-obvious bits: OpenAI `system` role → Gemini `config.systemInstruction` (Gemini has no system role in `contents`); `assistant` role → `model`; `response_format:{type:"json_object"}` → `config.responseMimeType="application/json"`; vision `image_url` must be a base64 **data URI** (mapped to `inlineData`), plain URLs are not fetched. Content can be `null` — return/normalize `resp.text ?? null` and skip null stream chunks.
- **Thinking-token starvation:** Gemini "thinking" models draw thoughts from the SAME `maxOutputTokens` pool, so a small budget returns EMPTY visible text (early probes saw `undefined`). The adapter sets `thinkingConfig:{thinkingBudget:0}` on every call — disables thinking, guarantees output within any budget, lowers latency. Right call for this extraction/classification/advisory app; revisit only if a task needs deep reasoning.
- **Build externalizes `@google/*`** (`artifacts/api-server/build.mjs`), so the bundled `dist/index.mjs` imports it at runtime. `@google/genai` MUST be a **direct dependency of `artifacts/api-server`** (not only the lib) or node fails with ERR_MODULE_NOT_FOUND. (The old `openai` pkg was bundled, not external, which is why it needed no such dep.)
- Installing `@google/genai` briefly created a `gaxios_tmp_*` dir in the pnpm store; Metro's file watcher crashed on it mid-install (mobile expo workflow). Transient — a restart after install clears it.
- Models: both tiers = `gemini-2.5-flash` (stable, reliably honors JSON mode + vision + streaming). Preview/pro models also work but need a larger budget and add a harmless `thoughtSignature` on parts.
- Image gen (`generateImageBuffer`/`editImages`) is stubbed to throw (unused, not supported here); the `audio` submodule was deleted.

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
