# Embedded LAN / Offline AI Architecture for Production Run Calculator

**Date:** 2026-10-03  
**Goal:** AI **built into the published app** so it works on any deploy — including a plant LAN with **no public internet**. Clients only need Wi‑Fi to the **local server**.  
**Non-goal:** Replacing Gemini quality when internet *is* available; hybrid is allowed, offline must still work.

---

## 1. Target operating modes

| Mode | Network | AI behavior |
|------|---------|-------------|
| **A. Cloud publish** (Replit today) | Internet | Gemini (or similar) via existing adapter; optional local if configured |
| **B. Plant LAN** | Private Wi‑Fi only; **no internet** | Local OpenAI-compatible inference on same LAN as API |
| **C. Strict air-gap** | No external path at all | Same as B; models installed via USB / approved media |

Clients (tablets/browsers) never call the model vendor. They only call **your API server** on the LAN. The server calls **local inference** (or cloud when online).

```text
[Tablet on plant Wi‑Fi]
        │  HTTPS / HTTP to app origin only
        ▼
[PRC API server] ──► [Local LLM :11434 or :8000]   ← same host or GPU box on LAN
        │
        ▼
[Postgres + app data]
```

This matches soft readiness already on `Replit`: **core app stays up** if AI is down or missing.

---

## 2. Architecture principle: one OpenAI-compatible surface

Keep **one** server-side adapter (you already have ~30 call sites shaped this way):

```text
pickModel("cheap" | "full")
  → resolve provider:
       LOCAL if LOCAL_AI_BASE_URL set and /v1/models reachable
       else GEMINI / cloud if key + internet
       else unavailable (feature degrades; no 503 on core)
```

**Env contract (illustrative):**

| Variable | Purpose |
|----------|---------|
| `LOCAL_AI_BASE_URL` | e.g. `http://127.0.0.1:11434/v1` or `http://ollama:11434/v1` |
| `LOCAL_AI_MODEL` | Default local model id |
| `LOCAL_AI_API_KEY` | Placeholder (`ollama` / `local`) — many local servers ignore it |
| `AI_MODE` | `auto` \| `local_only` \| `cloud_only` |
| Existing Gemini keys | Used only when `AI_MODE` allows cloud and network works |

**Plant default:** `AI_MODE=local_only` so a misconfigured cloud key never causes outbound attempts.

---

## 3. Inference placement options

| Option | Layout | Pros | Cons |
|--------|--------|------|------|
| **1. Sidecar on API host** | Docker Compose: `api` + `ollama` | Simple; one box | API and GPU fight for resources |
| **2. Dedicated GPU box on LAN** | API → `http://gpu-box:11434/v1` | Scale inference separately | Extra machine; firewall rules |
| **3. Same process (llama.cpp embedded)** | Rare for Node | Fewer containers | Harder ops; less common in Node stacks |

**Recommended for a pizza plant:**  
**Option 1** for small sites (one mini-PC/GPU workstation).  
**Option 2** if the API stays on Replit-class CPU and inference is on a local RTX box.

Ollama production pattern: bind API to **loopback or internal Docker network**, not the public internet. App server reaches it via `http://ollama:11434` on the compose network, or `http://127.0.0.1:11434` on the host. Do **not** expose 11434 to the whole Wi‑Fi without auth.

---

## 4. Docker Compose sketch (LAN deploy)

Illustrative — align with your existing `docker-compose.yml` / Replit deploy later.

```yaml
services:
  api:
    # existing PRC api-server image
    environment:
      LOCAL_AI_BASE_URL: http://ollama:11434/v1
      LOCAL_AI_MODEL: qwen2.5-coder:14b
      AI_MODE: local_only
      # DATABASE_URL, etc.
    depends_on:
      ollama:
        condition: service_healthy

  ollama:
    image: ollama/ollama:<PINNED_TAG>
    restart: unless-stopped
    volumes:
      - ollama_data:/root/.ollama
    environment:
      OLLAMA_HOST: 0.0.0.0:11434
      OLLAMA_KEEP_ALIVE: 24h
      OLLAMA_CONTEXT_LENGTH: "32768"   # agents/tools need far more than default 4k
      OLLAMA_NUM_PARALLEL: "1"
      OLLAMA_MAX_LOADED_MODELS: "1"
    # Prefer NOT publishing 11434 to the LAN; only api talks to it
    expose:
      - "11434"
    # GPU example (NVIDIA):
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - capabilities: [gpu]
    healthcheck:
      test: ["CMD-SHELL", "ollama list >/dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

volumes:
  ollama_data:
```

**Preload models offline** (on a connected machine, then copy volume / `ollama create` from blobs):

```bash
ollama pull qwen2.5-coder:14b
# optional: smaller fallback
ollama pull qwen2.5:7b
```

Air-gap update path: download GGUF/Ollama blobs on an internet machine → checksum → USB → import on plant host. Never require `ollama pull` at runtime on the plant.

---

## 5. Hardware reality (plant floor)

| Tier | Hardware (order of magnitude) | Usable models | Role |
|------|-------------------------------|---------------|------|
| **Minimum** | 16 GB RAM, modest GPU 8–12 GB or strong CPU | 7B–9B instruct | Chat / light assist; weak tools |
| **Practical** | 32 GB RAM + **24 GB VRAM** (RTX 3090/4090 class) | 14B–32B Q4 coding/instruct | Import assist, structured extract, tool calls |
| **Comfortable** | 64 GB RAM + 24–48 GB VRAM | 30B-class + larger context | Better multi-step, longer docs |

Agent / tool-calling work wants:

- Coding- or tool-tuned models (e.g. Qwen coder family)  
- **Context ≥ 32k** (64k better for long sheets)  
- Expect **lower quality than Gemini** — design UX for “draft + human Apply”

CPU-only is possible but slow for interactive floor use; plan on a GPU box for plant mode.

---

## 6. What AI features work offline vs not

| Feature | Offline viable? | Notes |
|---------|-----------------|-------|
| Facility knowledge Q&A (RAG over local DB/docs) | **Yes** | Embeddings + local LLM; index built offline |
| Spec / sheet parse **assist** (propose fields) | **Yes** | Structured JSON + validate server-side |
| Import alias / name match suggestions | **Yes** | Prefer deterministic first; LLM second |
| QC draft notes / checklist hints | **Yes** | Never auto-disposition |
| Photo defect vision | **Maybe** | Needs multimodal local model + GPU; often weaker |
| Live web research / latest prices | **No** | No internet |
| Cloud Gemini quality ceiling | **No** offline | Hybrid when online |
| Model download / `ollama pull` | **No** at runtime | Pre-stage models |

**Product rule (unchanged):** AI **proposes**; humans **Apply**. No silent LWW from AI. Soft readiness keeps the plant running if the GPU box is off.

---

## 7. App-layer changes (bounded)

1. **Provider resolver**  
   - Probe `LOCAL_AI_BASE_URL/models` on startup / periodic soft check  
   - Report in health `capabilities.ai`: `local` | `cloud` | `none`  
   - Never hard-fail `/readyz` on AI (already true on Replit)

2. **Timeouts & concurrency**  
   - Local models are slower: longer timeouts for AI routes only  
   - Queue or reject parallel heavy jobs (`OLLAMA_NUM_PARALLEL=1` initially)

3. **Structured outputs**  
   - Always Zod-validate; retry once on parse failure  
   - Smaller models need stricter prompts and fewer tools

4. **RAG for facility knowledge**  
   - Vectors in Postgres or local files; no external embedding API  
   - Optional: same local model for embeddings if quality OK

5. **Feature flags**  
   - `ai.importAssist`, `ai.qcDraft`, `ai.chat` independently toggleable  
   - Plant profile: enable only measured-safe skills

6. **Logging**  
   - Log provider = local|cloud, model id, latency — not full prompts with secrets in shared logs

---

## 8. Security on plant Wi‑Fi

| Control | Why |
|---------|-----|
| Clients → **only app HTTPS** (or HTTP on isolated VLAN) | Tablets never speak to Ollama |
| Ollama **not** published to guest Wi‑Fi | Unauthenticated by default |
| Auth still required on app routes | AI does not bypass capability gates |
| No outbound firewall path required | Offline mode must not hang on DNS to Google |
| Model files treated as software artifacts | Checksums on USB import |

---

## 9. Hybrid policy (recommended)

```text
if AI_MODE == local_only:
    use local only
elif AI_MODE == cloud_only:
    use cloud only
else:  # auto
    if local healthy: prefer local for "cheap" / privacy skills
    if cloud healthy: use for "full" / hard tasks
    if neither: degrade gracefully
```

Replit/public deploy can keep Gemini as default.  
Plant compose sets `local_only` + preloaded models.

---

## 10. Phased delivery (aligned with your roadmap)

| Phase | Deliverable | Exit criteria |
|-------|-------------|---------------|
| **0** | Soft readiness (done on Replit) | Core up without AI |
| **1** | `LOCAL_AI_*` env + provider probe + health capability | API works against Ollama on localhost |
| **2** | Compose profile `plant` with Ollama sidecar + model preload docs | LAN install guide; one offline skill (e.g. chat over facility knowledge) |
| **3** | Import / QC **draft** skills validated offline | Zod pass rate measured; Apply still human |
| **4** | Optional USB model update runbook + checksums | Air-gap update without internet |
| **5** | Optional hybrid auto routing | Online sites get cloud quality when available |

Do **not** block Phase A (uptime) or QC Phase 1 schema on local LLM quality.

---

## 11. Relation to prior research

| Prior thread | How it fits |
|--------------|-------------|
| Soft readiness | Required foundation — offline AI is optional capability |
| No-API agents (Cline/OpenCode) | For **developers**; plant path is **server-side** inference |
| QLoRA / distillation | Optional later to shrink models for weaker plant GPUs |
| AI gateway design | Local becomes another **provider** behind the same skills |
| Facility knowledge | Primary offline RAG corpus |
| Value protection / Apply | Non-negotiable with weak local models |

---

## 12. Honest limits

- Local 14B–32B will **not** match Gemini on hard ambiguous imports.  
- Vision, long multi-document reasoning, and unreliable tool use need UX that expects edits.  
- One GPU box is a **single point of failure** for AI — not for production runs (soft readiness).  
- Model updates on air-gap are an **ops process**, not `docker pull` magic.

---

## 13. Bottom line

To work **anywhere published**, including **Wi‑Fi-only plant networks**:

1. **Never** put cloud API keys in the critical path for core readiness.  
2. Run an **OpenAI-compatible local server** (Ollama or vLLM) next to or near the API.  
3. Point the existing adapter at `LOCAL_AI_BASE_URL`.  
4. Preload models; set large context; validate structured outputs.  
5. Keep **human Apply** and capability gates.  
6. Ship a **plant compose profile** and a USB model-update runbook for true offline.

That is the architecture that matches “built into the app” and “100% without internet, only LAN.”

---

*Architecture research 2026-10-03 — embedded LAN/offline AI for PRC.*
