# No-API / Fully Local AI Agents — Deep Research

**Date:** 2026-10-03  
**Focus:** Agents that can run **without cloud LLM API keys** (Ollama, LM Studio, llama.cpp, vLLM)  
**Companion:** `free-open-source-ai-agents-research-2026-10-03.md`

---

## 1. What “no API” actually means

Four layers can leave the machine. **All must be local** for a true no-API setup:

| Layer | Local requirement |
|-------|-------------------|
| **Inference** | Weights + runtime on your hardware (Ollama / LM Studio / llama.cpp / vLLM) |
| **Agent harness** | Open-source software that points at `http://localhost:…/v1` |
| **Tools** | File/shell tools local; avoid web-search MCP unless intentional |
| **Telemetry** | No phone-home; disable auto-update / analytics if present |

Many agents are “BYOK” (bring your own key) — they still work offline if you set:

```text
baseURL = http://localhost:11434/v1   # Ollama OpenAI-compatible
apiKey  = ollama                      # placeholder; often ignored
model   = qwen2.5-coder:14b           # whatever you pulled
```

**Critical trap:** Ollama’s default context is often **too small** for agent loops (system prompt + tools + history). Guides repeatedly require raising context:

- OpenHands: often **≥22k–32k** (`OLLAMA_CONTEXT_LENGTH`)
- OpenCode: often **≥64k** for reliable tool calling

Without that, agents look “broken” even with a good model.

---

## 2. Best no-API coding agents (2026 consensus)

| Agent | License | Interface | Local path maturity | Notes |
|-------|---------|-----------|---------------------|--------|
| **OpenCode** | MIT | Terminal TUI (+ desktop/IDE) | Excellent — Ollama, LM Studio, llama.cpp documented | Strong “Claude Code–like” OSS; `ollama launch opencode` shortcut |
| **Cline** | Apache 2.0 | VS Code / IDE | Strong — Ollama / LM Studio / OpenAI-compatible | Explicit step approvals; good air-gap story |
| **goose** | Apache 2.0 | Desktop + CLI | Excellent — many local providers listed | MCP extensions; foundation stewardship |
| **Aider** | Apache 2.0 | Terminal, git-native | Strong | Pair-programming + commits; quality floors on small models |
| **OpenHands** | MIT | Web UI + Docker sandbox | Strong but heavier | Full autonomous loop; needs GPU + large context; Docker networking to host Ollama |
| **CondorCode** | OSS | CLI | Built for local-only | Explicitly “no API key, no cloud” |
| **Continue** | — | IDE | Local via Ollama | Maintenance caution in some 2026 notes — verify activity |

**Practical picks:**

| Constraint | Start with |
|------------|------------|
| VS Code daily driver | **Cline + Ollama** |
| Terminal + git | **Aider** or **OpenCode** |
| Max local provider list | **goose** |
| Autonomous issue-style tasks | **OpenHands + Ollama** (expect weaker than cloud frontier) |
| Minimal “offline only” CLI | **CondorCode** / OpenCode |

---

## 3. General / personal no-API agents

| Agent | Role | Local notes |
|-------|------|-------------|
| **AnythingLLM** | Docs + RAG + agents | Fully offline path well documented |
| **OpenClaw** | Multi-channel assistant | Ollama config guides exist |
| **Hermes Agent** | Self-improving personal agent | Own endpoint / local |
| **LocalAGI** | Self-host agent platform | Consumer hardware; OpenAI-compatible surface |
| **LeAgent** | Desktop agent + offline tools | Ollama / vLLM path |
| **Atomic Agent** | Local-first loop + approvals | llama.cpp offline guides |

For **document Q&A only** (not coding): AnythingLLM + local embeddings is the shortest path.

---

## 4. Frameworks that work offline (build-your-own)

Any framework that accepts an **OpenAI-compatible base URL** works with Ollama:

| Framework | Local fit |
|-----------|-----------|
| **LangGraph / LangChain** | `ChatOllama` or OpenAI client → `localhost:11434` |
| **CrewAI** | Point LLM config at Ollama |
| **smolagents** | Local model backends |
| **Pydantic AI** | Custom model endpoint |
| **LlamaIndex** | Local LLM + local vector store |

For **in-app** product (PRC): prefer a thin tool loop or LangGraph with:

- `LOCAL_AI_BASE_URL` (you already researched this pattern)
- No network egress in production profile
- Human **Apply** still required

---

## 5. Models that work better as local agents

Agent loops need **tool calling + instruction following**, not just chat fluency.

| Class | Examples (names shift) | Rough hardware |
|-------|------------------------|----------------|
| Coding 7B–14B | Qwen2.5-Coder 14B, CodeLlama 13B | 12–16 GB |
| Coding 30B-class | Qwen3-Coder 30B | ~24 GB |
| General agent / MoE | Qwen3.x MoE variants, Gemma agent-tuned | 16–24 GB+ |
| Minimal laptop | 7B–9B instruct | 8–12 GB (limited agent quality) |

Honest expectation from 2026 writeups:

- Local **≠** Claude/GPT quality on hard multi-step coding  
- Local **=** private, free marginal cost, good enough for many refactors / docs / internal tools  
- **≥14B coding-tuned** is a practical floor for “feels agentic”

---

## 6. Reference local stacks

### A. Cline + Ollama (IDE)

```bash
# Install Ollama, then:
ollama pull qwen2.5-coder:14b
# Optional: raise context for tool use
OLLAMA_CONTEXT_LENGTH=32768 ollama serve
```

In Cline: provider **Ollama**, select pulled model, approve tools as needed.

### B. OpenCode + Ollama (terminal)

```bash
ollama launch opencode
# or configure baseURL http://localhost:11434/v1
# Prefer high num_ctx / OLLAMA_CONTEXT_LENGTH ≥ 64k for tools
```

### C. OpenHands + Ollama (autonomous)

- Run Ollama on host with large `OLLAMA_CONTEXT_LENGTH`  
- Docker: `--add-host host.docker.internal:host-gateway`  
- UI: custom model `openai/<ollama-model-name>`, base URL `http://host.docker.internal:11434/v1`, dummy API key  

### D. In-app adapter (PRC-style)

```text
LOCAL_AI_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_AI_MODEL=qwen2.5-coder:14b
# pickModel("cheap") → local; "full" → Gemini only if configured
# readiness: AI remains optional (soft readiness already on Replit)
```

---

## 7. Failure modes specific to no-API agents

| Symptom | Likely cause |
|---------|----------------|
| Ignores tools / empty function calls | Context window too small |
| Loops / nonsense | Model too small for agentic use |
| Slow | CPU-only inference; use GPU |
| Docker agent can’t reach Ollama | Missing `host.docker.internal` / firewall |
| “Works in chat, fails as agent” | Chat model vs tool-tuned coding model |
| Still phones home | Telemetry, update check, or web MCP enabled |

---

## 8. Security (local is not automatically safe)

- Shell + write tools = **local privilege**. Prefer approval gates (Cline-style).  
- Sandbox when possible (OpenHands Docker).  
- Don’t point a local agent at production DB credentials without read-only roles.  
- Air-gap: disable web tools, auto-update, and cloud embeddings.

---

## 9. Fit to Production Run Calculator

| Use | No-API recommendation |
|-----|------------------------|
| **Developer productivity** on the monorepo | Cline or OpenCode + Qwen coder local |
| **In-app offline assist** (import hints, QC draft) | Existing OpenAI-compatible adapter → Ollama; **propose only** |
| **Facility docs RAG** | AnythingLLM or LlamaIndex + local embeddings |
| **Autonomous plant control** | **Do not** — keep Apply / claims / purge human-gated |
| **Distillation / QLoRA** | Separate offline track; still gated by Phase-0 quality bars |

Aligns with prior research: local is **Option B** for privacy and cost; cloud Gemini remains quality ceiling until measured otherwise.

---

## 10. Suggested trial order (weekend-sized)

1. Install **Ollama** + pull `qwen2.5-coder:14b` (or current best coder on your VRAM).  
2. Raise context (`OLLAMA_CONTEXT_LENGTH=32768` or higher).  
3. Connect **Cline** *or* **OpenCode** — one coding task on a throwaway branch.  
4. If useful, wire `LOCAL_AI_BASE_URL` into the app’s cheap model path (already in architecture notes).  
5. Keep production Apply gates unchanged.

---

## 11. Bottom line

**No-API agents are real in 2026** if you accept:

- Your GPU/RAM as the bill  
- Coding-tuned local models ≥ ~14B for agent loops  
- Explicit large context configuration  
- Lower ceiling than frontier APIs  

**Best starting software for no-API:**

1. **Cline** (IDE) or **OpenCode** (terminal)  
2. **goose** if you want desktop + MCP breadth  
3. **OpenHands** if you want sandbox autonomy and can afford the setup  

For the plant app: local agents should **assist and draft**; they should not become the system of record without human Apply.

---

*Research 2026-10-03 — no-API / fully local AI agents.*
