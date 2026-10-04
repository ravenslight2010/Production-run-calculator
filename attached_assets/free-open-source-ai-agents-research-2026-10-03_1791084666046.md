# Free Open-Source AI Agents — Research Snapshot

**Date:** 2026-10-03  
**Scope:** Software that is free to self-host / MIT–Apache style, with honest notes on model cost  
**Caveat:** “Free agent” ≠ free inference. Truly $0 usually means **local models** (Ollama, LM Studio, llama.cpp) on your hardware.

---

## 1. Two different things people mean by “AI agent”

| Category | What it is | Examples |
|----------|------------|----------|
| **Frameworks** | Libraries you use to *build* agents (tools, memory, multi-agent) | LangGraph, CrewAI, smolagents, Pydantic AI |
| **Ready-to-run agents / harnesses** | Products you install and talk to | OpenHands, Cline, OpenCode, Aider, goose, OpenClaw |

Pick frameworks when embedding agents in *your* app (e.g. PRC AI gateway).  
Pick harnesses when you want a coding/personal assistant on a machine.

---

## 2. Truly free stack (software + local model)

To avoid API bills:

1. Open-source agent software (MIT / Apache 2.0 preferred)  
2. Local inference (Ollama / LM Studio / vLLM / llama-server)  
3. Hardware you already own  

Many “free” agents still default to paid APIs; check provider docs for **Ollama / OpenAI-compatible base URL**.

---

## 3. Frameworks (build your own)

| Framework | License (typical) | Best for | Notes |
|-----------|-------------------|----------|--------|
| **LangGraph** | MIT | Production stateful workflows, HITL, checkpoints | Steeper curve; strongest production consensus 2026 |
| **LangChain** | MIT | Broad integrations, connectors | Ecosystem; pair with LangGraph for agents |
| **CrewAI** | MIT | Fast role-based multi-agent crews | Quick prototypes; less control than graphs |
| **smolagents** (HF) | Apache 2.0 | Minimal code-as-action agents | Lightweight |
| **Pydantic AI** | MIT | Typed Python agents | Good for structured outputs |
| **Agno** | Apache 2.0 | Lightweight agent platforms | Growing |
| **LlamaIndex Agents** | MIT | RAG-heavy agents | Retrieval-first |
| **OpenAI Agents SDK** | MIT | Lean multi-agent (OpenAI-centric) | Software free; API billed |
| **Google ADK** | Apache 2.0 | Google-oriented agent toolkit | Strong if on GCP |
| **Mastra** | (check repo) | TypeScript / JS agents | Main TS option in many 2026 roundups |
| **Microsoft Agent Framework** | MIT | Enterprise / AutoGen successor | Prefer over new AutoGen work |
| **AutoGen** | MIT / docs CC | Legacy multi-agent chat | **Maintenance mode** — avoid for greenfield |

**Practical picks:**

- Production control + approvals → **LangGraph**  
- Role teams in a day → **CrewAI**  
- Minimal Python → **smolagents** or **Pydantic AI**  
- TypeScript → **Mastra**

---

## 4. Ready-to-run / coding agents (free software)

| Agent | License | Best for | Local models? |
|-------|---------|----------|----------------|
| **OpenHands** (ex-OpenDevin) | MIT | Autonomous software tasks, sandbox | Yes (OpenAI-compatible) |
| **Cline** | Apache 2.0 | IDE coding agent (VS Code etc.) | Yes |
| **OpenCode** | MIT | Terminal coding agent, multi-provider | Yes (Ollama, LM Studio, llama.cpp) |
| **Aider** | Apache-style | Git-native CLI pair programming | Yes (any OpenAI-compatible) |
| **goose** (Block → foundation) | Apache 2.0 | Desktop/CLI general agent, MCP extensions | Yes (many local providers) |
| **Open Interpreter** | — | Terminal agent, open-weight friendly | Yes |
| **Continue** | — | Open Copilot-style IDE assist | Yes |
| **OpenClaw** | MIT | Self-hosted multi-channel assistant | Yes |
| **Hermes Agent** | MIT | Self-improving personal agent | Via own endpoint |
| **AnythingLLM** | MIT | Docs + RAG + agents in one app | Yes |
| **n8n** (Community) | Sustainable Use (self-host) | Workflow automation + AI nodes | Yes |
| **Dify** | Modified Apache | Visual AI app builder | Self-host free core |

**Coding-focused shortlist:** Cline (IDE), OpenCode / Aider (terminal), OpenHands (autonomous issues).

---

## 5. “Actually free” nuance (from 2026 guides)

| Layer | Free? |
|-------|--------|
| Agent software (MIT/Apache) | Usually yes |
| Hosted “free tier” of same product | Often limited credits |
| Frontier API (GPT/Claude/Gemini) | **No** — pay per token |
| Local 7B–32B model | **Yes** — electricity + VRAM only |
| Enterprise cloud of OSS project | Paid |

Rule of thumb: if privacy and $0 inference matter, require **documented local provider** support before adopting.

---

## 6. Decision guide

```text
Need to BUILD agents into an app?
  ├─ Stateful / HITL / production → LangGraph
  ├─ Role crews fast → CrewAI
  ├─ Typed Python → Pydantic AI / smolagents
  └─ TypeScript → Mastra

Need a CODING assistant on your machine?
  ├─ VS Code → Cline or Continue
  ├─ Terminal + git → Aider or OpenCode
  └─ Autonomous issues in Docker → OpenHands

Need a PERSONAL / chat assistant self-hosted?
  → OpenClaw, goose, Hermes, AnythingLLM

Need WORKFLOW automation with AI?
  → n8n Community (self-host)
```

---

## 7. Fit notes for Production Run Calculator (context)

Your app already has:

- OpenAI-compatible adapter surface  
- Soft readiness (AI optional)  
- Facility knowledge / corrections / apply gates  
- Interest in local AI + distillation (mostly no-go so far)

**Agent frameworks** that align best:

| Goal | Candidate | Why |
|------|-----------|-----|
| Structured import / QC assist with tools | LangGraph or Pydantic AI | Explicit steps, human Apply gate |
| Multi-role “import → review → apply” | CrewAI | Roles map to manager/QC |
| Keep TS stack | Mastra or thin custom tool loop | Matches Node monorepo |
| Dev productivity on the repo | Cline / OpenCode / Aider | Not in-app; for you as developer |

**Avoid for in-app product authority:** fully autonomous agents that write master data without Apply / claim gates. Agents should **propose**; humans **apply**.

---

## 8. Risks and hygiene

- **AutoGen:** maintenance mode; use Microsoft Agent Framework for new MS work.  
- **Stars ≠ quality:** viral harnesses move fast; pin versions.  
- **Tool permissions:** coding agents with shell access need sandboxing (Docker).  
- **License:** “open source” vs “source available” — verify before commercial embed.  
- **Eval:** agents need task evals (not just chat demos) before production.

---

## 9. Suggested starting experiments (low cost)

1. **Dev only:** Install **Cline** or **OpenCode** + Ollama (e.g. Qwen/DeepSeek class model) for repo work.  
2. **Framework spike:** One LangGraph graph: “parse import → validate → produce Apply payload” with no auto-write.  
3. **RAG assist:** AnythingLLM or LlamaIndex over your `docs/` folder for internal Q&A.  
4. **Do not** wire autonomous agents to purge-all, sync, or inventory mutations without capability gates.

---

## 10. Sources (themes, late 2026)

Roundups and comparisons from AGNT, SandBase, Gravity, KDnuggets, toolradar, MarkTechPost, findarepo, and multi-framework comparison posts (LangGraph / CrewAI / AutoGen status). Star counts and product names shift weekly — always re-check GitHub license and local-model docs before adopting.

---

*Research snapshot 2026-10-03 — free/open-source AI agents and frameworks.*
