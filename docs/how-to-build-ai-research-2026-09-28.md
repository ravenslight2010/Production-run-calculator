# How to Build AI — Research Pack (2026)

**Date:** 2026-09-28  
**Scope:** Practical guide to building production AI systems (LLM apps, RAG, agents).  
**Audience:** Product / eng teams shipping real features — not training foundation models from scratch.

---

## 1. What “building AI” usually means

Almost nobody trains GPT-class models from zero. Production work is engineering a **system around a model**.

| Approach | What you build | When to use |
|----------|----------------|-------------|
| **LLM app** | Prompt + API + UI | Q&A, summarization, drafts, structured extraction |
| **RAG** | Retrieval over *your* data + LLM | Docs, policies, product knowledge, private data |
| **Agent** | LLM + tools + loop (reason → act → observe) | Multi-step tasks that call APIs, DBs, calculators |
| **Fine-tune / distill** | Adapt a smaller model | High volume, narrow domain, cost control |

---

## 2. Core components of a modern AI system

Every serious build has some version of these:

1. **Model** — Hosted (OpenAI, Anthropic, Gemini) or self-hosted (vLLM, Ollama, SGLang)
2. **Orchestration** — Prompt chaining, routing, or agent loop
3. **Tools** — Functions the model can call (DB, search, calculators, your APIs)
4. **Context / memory** — Chat history, RAG, structured state
5. **Guardrails** — Limits, approvals, schema validation, refusal rules
6. **Evals + observability** — Test sets, tracing, cost/latency monitoring

Agent-oriented architecture: **model + tools + loop + memory + evaluation**.

---

## 3. Step-by-step: how teams actually ship

Consensus across 2026 production guides:

### Step 1 — Narrow the job

- **Bad:** “Handle customer support.”
- **Good:** “Resolve order-status questions; escalate everything else.”

Criteria that work:

- Bounded input and output  
- 2–8 tools maximum  
- Measurable success (completion rate, escalation rate, accuracy)

### Step 2 — Build the eval set *before* the fancy stack

- 50–100+ real examples with expected outcomes  
- Without this, you cannot tell if changes help or hurt  
- Expand only when evals are green

### Step 3 — Start simple

- One model API call + structured output is often enough  
- Add RAG only if the model needs private/domain data  
- Add an agent loop only if the task needs multiple tool steps

**Minimal agent loop (conceptual):**

```text
messages = [system, user task]
for step in 1..max_steps:
  response = llm(messages, tools)
  if response is final answer → stop
  if response is tool call → run tool, append result
  if stuck / budget hit → escalate to human
```

### Step 4 — Design tools carefully

- One job per tool  
- Clear names and descriptions  
- Strict input/output schemas (JSON Schema / Zod)  
- Explicit human approval for irreversible actions  

### Step 5 — Add RAG when needed

Production RAG is not “chunk + embed.” It is a pipeline:

1. Ingest / parse  
2. Chunk with metadata  
3. Embed + store (often hybrid: vector + keyword)  
4. Retrieve → optional rerank  
5. Generate with grounding rules  
6. Evaluate retrieval and answers **separately** (e.g. RAGAS-style metrics)

### Step 6 — Guardrails and ops

- Step and cost limits  
- Sandbox for code/actions  
- Tracing (LangSmith, Langfuse, OpenTelemetry)  
- CI evals on every change  
- Human-in-the-loop for high-impact actions  

---

## 4. Typical 2026 stack (pick by constraints)

| Layer | Common choices |
|-------|----------------|
| **Models** | Claude / GPT / Gemini (frontier); cheaper tiers for bulk work |
| **Orchestration** | Custom loop, OpenAI Agents SDK, LangGraph, Pydantic AI, Vercel AI SDK, CrewAI |
| **Retrieval** | pgvector (if already on Postgres), Pinecone, Qdrant |
| **Inference (self-host)** | vLLM, SGLang, Ollama (dev) |
| **Protocols** | Tool/function calling; MCP for tool servers |
| **Evals / tracing** | Promptfoo, RAGAS, LangSmith, Langfuse |

**Rule of thumb:** Start with a hosted API + thin app code. Self-host only when privacy, cost at scale, or latency force it.

### Framework comparison (agents, 2026 snapshot)

| Framework | Best for | Notes |
|-----------|----------|-------|
| **LangGraph** | Complex stateful workflows, auditability | Steeper learning curve; strong production use |
| **CrewAI** | Role-based multi-agent prototypes | Faster to first agent |
| **OpenAI Agents SDK** | OpenAI ecosystem, single-agent + sandbox | Lightweight |
| **Pydantic AI** | Typed Python, structure without heavy deps | Great for small/medium projects |
| **Vercel AI SDK** | TypeScript / Next.js | Strong TS ergonomics |
| **Custom loop** | Maximum control, minimal deps | Often best for first production agent |

---

## 5. Agent patterns that work

From production practice (including Anthropic-style patterns):

| Pattern | Description |
|---------|-------------|
| **Prompt chaining** | Fixed sequence of steps |
| **Routing** | Classify, then specialize |
| **Tool use / ReAct** | Reason → act → observe → repeat |
| **Orchestrator + workers** | Planner + specialist agents |
| **Evaluator–optimizer** | Generate, critique, improve |

Prefer the **simplest** pattern that hits your eval bar. Complexity kills reliability.

---

## 6. Production RAG checklist

**Offline (index):**

- [ ] Define corpus and primary use case  
- [ ] Ingest + parse (preserve metadata)  
- [ ] Chunk strategy appropriate to document types  
- [ ] Embedding model locked and measured  
- [ ] Hybrid retrieval baseline (vector + keyword)  

**Online (query):**

- [ ] Query understanding / optional rewrite  
- [ ] Retrieve → optional rerank  
- [ ] Grounded generation with refusal when evidence is weak  
- [ ] Citations / source attribution where required  

**Quality gates:**

- [ ] Separate evals for retrieval (precision@k, recall) and generation (faithfulness, relevance)  
- [ ] Hallucination tests (questions with no answer in corpus)  
- [ ] Permission-aware retrieval if multi-tenant  
- [ ] Observability on every stage  

---

## 7. Realistic timeline and cost (indicative)

| Scope | Timeline | Ballpark |
|-------|----------|----------|
| Simple tool agent / MVP | 2–6 weeks | Low five figures or internal eng time |
| Multi-agent + human-in-the-loop | 4–10 weeks | Higher |
| Enterprise (compliance, multi-system) | Months | Six figures |

Most failure is **scope and evals**, not model choice.

---

## 8. Common failure modes

1. Scope too wide (“do everything”)  
2. No eval set → endless prompt tweaking  
3. Too many tools → model picks wrong ones  
4. RAG without measuring retrieval quality  
5. No limits → runaway cost / infinite loops  
6. Shipping without tracing  
7. Treating demo accuracy as production readiness  

---

## 9. Practical path if starting today

1. **One use case** with a clear success metric  
2. **Hosted model** (e.g. OpenAI or Anthropic) + structured outputs  
3. **Three tools or fewer**  
4. **Eval set of real examples**  
5. Minimal loop or lightweight framework  
6. Logging, budgets, human approval for side effects  
7. Expand only when evals are green  

---

## 10. Relevance to Production Run Calculator

The app already uses **OpenAI** (import / model chain). Natural next AI features:

| Feature | Pattern | Risk / control |
|---------|---------|----------------|
| Guided import / extraction from messy factory files | Structured LLM extraction (partially present) | Schema validation; human confirm before apply |
| Natural-language queries over run/history data | RAG over day-state + docs | Read-only tools first |
| Packaging / sauce plan proposals | Agent with calculators + templates | Propose only; never write without confirmation |
| Anomaly / drift hints on live calc | Lightweight classifier or rules + LLM explain | Soft suggestions, not hard writes |

**Recommended order for this codebase:**

1. Harden existing AI import path (evals on real factory files)  
2. Read-only NL query over protected domain data  
3. Propose-only planning agent with explicit apply step  

Align any new AI path with existing **value protection**, **claim state machine**, and **readiness** patterns so AI never becomes another source of silent overwrites or hard 503s.

---

## 11. Quick reference — production agent checklist

- [ ] Narrow, measurable objective  
- [ ] Eval set before orchestration  
- [ ] Model matched to task (capability vs cost)  
- [ ] Tools: few, clear, schema-validated  
- [ ] Hard step / cost / time limits  
- [ ] Human approval for irreversible actions  
- [ ] Tracing on every run  
- [ ] CI evals on every change  
- [ ] Pilot with real users before scale  

---

## 12. Sources & further reading (research basis)

Research synthesized from 2026 production guides on:

- Autonomous AI agent engineering roadmaps  
- Production agent stacks (LLM + harness + sandbox + store + evals)  
- Framework comparisons (LangGraph, CrewAI, OpenAI Agents SDK, Pydantic AI, Vercel AI SDK)  
- Enterprise RAG architecture (ingestion → hybrid retrieval → grounded generation → observability)  
- Self-hosted vs hosted inference (vLLM, Ollama, frontier APIs)  

Key themes repeated across independent sources: **narrow scope first**, **evals before frameworks**, **tools over clever prompts**, **guardrails and tracing as first-class**.

---

*Document generated 2026-09-28 as a consolidating research pack for “how to build AI” work so far.*
