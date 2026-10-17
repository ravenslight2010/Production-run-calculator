# LOCAL_AI Adapter Checklist (against real call sites)

**Date:** 2026-10-03  
**Branch reference:** `Replit` @ `3412b790`  
**Primary package:** `lib/integrations-openai-ai-server`  
**Health:** `artifacts/api-server/src/routes/health.ts`

---

## 1. What exists today

| Piece | Reality |
|-------|---------|
| Public surface | OpenAI-shaped: `openai.chat.completions.create({ model, messages, response_format, max_completion_tokens, stream? })` |
| Implementation | **Gemini-only** via `@google/genai` (`client.ts`) |
| Credentials | `AI_INTEGRATIONS_GEMINI_API_KEY` (+ optional `AI_INTEGRATIONS_GEMINI_BASE_URL`) **or** `GOOGLE_API_KEY` |
| Model pick | `pickModel("full" \| "cheap")` → both currently `gemini-2.5-flash` (`models.ts`) |
| Config probe | `isGeminiProviderConfigured(env)` — **credential presence only**, not a live probe |
| Readiness | Soft: AI missing → `capabilities.ai: not_configured` / dependencies warning; **does not 503** core |
| Resilience | Circuit breaker, timeout, 1 retry, metrics observer |
| Related helpers | `aiJsonRetry`, `aiBoundedJson`, `aiDataBoundary`, `aiResultCache`, batch helpers |

**Implication:** Call sites do not import Gemini types. They import `openai` / `pickModel` from `@workspace/integrations-openai-ai-server`. A local provider should sit **behind the same exports** so routes stay unchanged.

---

## 2. Target env contract

| Variable | Required | Meaning |
|----------|----------|---------|
| `AI_MODE` | No (default `auto`) | `auto` \| `local_only` \| `cloud_only` |
| `LOCAL_AI_BASE_URL` | For local | OpenAI-compatible base, e.g. `http://ollama:11434/v1` |
| `LOCAL_AI_API_KEY` | No | Placeholder (`ollama` / `local`); many servers ignore |
| `LOCAL_AI_MODEL` | Recommended | Default model id for both tiers until split |
| `LOCAL_AI_MODEL_CHEAP` | Optional | Override cheap tier |
| `LOCAL_AI_MODEL_FULL` | Optional | Override full tier |
| `LOCAL_AI_TIMEOUT_MS` | Optional | Default higher than cloud (e.g. 90_000–120_000) |
| Existing Gemini keys | For cloud | Unchanged |

**Plant default:** `AI_MODE=local_only` + `LOCAL_AI_BASE_URL` set.  
**Replit default:** leave unset / `auto` with Gemini keys (current behavior).

---

## 3. Adapter design (minimal change)

### 3.1 Provider resolution order

```text
function resolveProvider(kind: ModelKind):
  mode = AI_MODE || "auto"

  if mode == "local_only":
    require local configured → use OpenAI SDK against LOCAL_AI_BASE_URL
  if mode == "cloud_only":
    require Gemini configured → existing GoogleGenAI path
  if mode == "auto":
    if local configured and (optional) healthy → local
    else if Gemini configured → cloud
    else → unavailable
```

### 3.2 Implementation sketch

- Keep exporting `openai` with `.chat.completions.create`.
- Inside `create`:
  - If provider is **local**: use official `openai` package `new OpenAI({ baseURL: LOCAL_AI_BASE_URL, apiKey: LOCAL_AI_API_KEY || "local" })` and call chat completions (same params the app already passes).
  - If provider is **cloud**: existing Gemini translation path.
- Map local model ids via `pickModel`:
  - Prefer `LOCAL_AI_MODEL_*` when local is selected.
  - Cloud keeps `AI_MODELS.full/cheap` as today.

### 3.3 Configuration helpers (extend, don’t break)

| Helper | Change |
|--------|--------|
| `isGeminiProviderConfigured` | Keep for cloud credential check |
| **New** `isLocalAiConfigured(env)` | `Boolean(LOCAL_AI_BASE_URL)` |
| **New** `isAiProviderConfigured(env)` | local **or** Gemini per `AI_MODE` |
| Health `capabilities.ai` | Use `isAiProviderConfigured`; optional `detail: "local" \| "cloud"` |

Soft readiness rule **must stay**: missing AI ≠ hard fail.

### 3.4 Optional live probe (soft only)

- Periodic or on-demand `GET {LOCAL_AI_BASE_URL}/models` (short timeout).
- Failure → treat local as unhealthy for `auto` fallback; never block `/readyz`.
- Do not require probe for `isLocalAiConfigured` (config-only is fine for v1).

---

## 4. Call-site checklist (do not rewrite)

Search / audit these; they should keep importing the workspace package only:

| Area | Notes |
|------|--------|
| Import / extract routes | JSON `response_format`; validate with existing Zod / `aiJsonRetry` |
| Facility knowledge / chat | Streaming path if used — local must support stream or degrade to non-stream |
| Vision / image_url parts | Local models may lack vision — feature-flag or cloud-only when `AI_MODE=auto` |
| Batch (`batchProcess`) | Longer timeouts; lower concurrency for local (`OLLAMA_NUM_PARALLEL=1`) |
| Image generate/edit | `generateImageBuffer` / `editImages` — **likely cloud-only** until a local image model is chosen |
| Tests | `geminiAdapter.test.ts`, `aiJsonRetry.test.ts`, `aiIntegrationBatch.test.ts` — add local fixture with mock OpenAI server |

**Rule:** No route should import `@google/genai` or hardcode `gemini-2.5-flash` except inside the integration package / tests.

---

## 5. Behavioral differences to handle

| Topic | Cloud (Gemini today) | Local (Ollama etc.) |
|-------|----------------------|---------------------|
| Latency | Lower | Higher — raise AI-route timeouts only |
| JSON mode | `responseMimeType` | Model-dependent; keep `aiJsonRetry` |
| Vision | Supported | Often not — gate features |
| Auth errors | Key / quota | Connection refused / model missing |
| Cost metrics | microusd 0 today | Keep 0 |
| Circuit breaker | Shared today | Prefer **per-provider** circuits so local down ≠ open circuit for cloud |

---

## 6. Implementation checklist (engineering)

- [ ] Add env parsing for `AI_MODE`, `LOCAL_AI_*` in integration package
- [ ] Branch `chat.completions.create` to OpenAI SDK client when local selected
- [ ] Extend `pickModel` for local model ids
- [ ] `isAiProviderConfigured` + health detail without hard-fail
- [ ] Per-provider circuit / metrics label (`provider: local|gemini`)
- [ ] Unit tests: local success, local down + `local_only` → unavailable, `auto` falls back to Gemini when local down
- [ ] Integration test with mock OpenAI-compatible server (or testcontainers Ollama — optional)
- [ ] Document plant `.env.example` entries
- [ ] Confirm image routes remain cloud-only or return clear “not available offline”
- [ ] No change to Apply / value protection / purge rules

---

## 7. Acceptance criteria

1. With only `LOCAL_AI_BASE_URL` + running Ollama, import/chat JSON skills succeed offline.  
2. With only Gemini keys (current Replit), behavior unchanged.  
3. With neither, `/api/readyz` still **200** and AI routes return provider-unavailable (existing pattern).  
4. `AI_MODE=local_only` never opens outbound Gemini connections.  
5. Existing focused tests still pass; new local tests green.

---

## 8. Non-goals (this checklist)

- Distillation / QLoRA  
- Replacing Gemini quality online  
- Exposing Ollama port to plant Wi‑Fi  
- Autonomous Apply of AI output  

---

*Checklist 2026-10-03 — LOCAL_AI behind existing OpenAI-shaped Gemini adapter.*
