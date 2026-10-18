# AI Research Continuation — Codebase Map & Next Digs

**Date:** 2026-09-29  
**Repo tip:** `main` @ `0623f50e` (experimental); primary deploy remains **replit**  
**Goal:** Extend prior AI research with what the **code actually has**, and rank the next research/engineering digs.

---

## 1. What we already researched (index)

| Doc | Focus |
|-----|--------|
| `how-to-build-ai-research-2026-09-28.md` | General LLM/RAG/agent production patterns |
| `ai-tailored-to-app-research-2026-09-28.md` | Phase A–E portfolio rules, non-negotiables |
| `local-ai-installation-research-2026-09-26.md` | Self-hosted Option B |
| `how-to-build-an-ai-research-2026-09-28.docx` | Fine-tune vs RAG vs pretrain economics |
| `distillation-experiment-design-2026-09-28.docx` | Conditional QLoRA plan |
| `ai-deep-dive-continuation-2026-09-28.md` | Quality boards, host cost, hybrid |
| `ai-phase0-adapter-dataset-design-2026-09-28.md` | Phase-0 metrics, dual-mode adapter, dataset |
| `qlora-distillation-techniques-2026-09-28.md` | Sequence-level SFT recipe |
| `qlora-unsloth-config-and-train-checklist-2026-09-28.md` | Config + train-safety |
| `lib-distill-dataset` (+ nearDup) | Manifest, safety, Jaccard helpers |
| `near-dup-hashing-research-2026-09-28.md` | Shingle/Jaccard vs MinHash |

---

## 2. Live AI surface area in the repo (inventory)

### 2.1 Route modules (server)

| Module | Likely role | Portfolio stance (Phase E) |
|--------|-------------|----------------------------|
| **`aiParseSpecSheet.ts`** | Workbook → profiles / applicators (core extract) | **Keep / invest** |
| **`aiMatchImport.ts`** | Match import rows to known items | **Keep** (cheap tier) |
| **`aiMatchPremix.ts`** | Premix name matching | **Keep** (cheap) |
| **`aiMixReconcile.ts`** | Mix discrepancy narrative/reconcile | Simplify → deterministic first |
| **`aiSpecReconcile.ts`** | Spec reconcile assist | Review; propose-only |
| **`aiSummary.ts`** | Summaries | Often narrates → simplify/retire |
| **`aiAnomalies.ts`** | Anomaly assist | Prefer deterministic triggers |
| **`aiScheduleOptimize.ts`** | Schedule optimize | **Retire / non-priority** (audit) |
| **`aiIncidentClusters.ts`** | Incident clustering | Secondary |
| **`ai.ts`** | Shared AI routes (ask, extraction adapters, cost limits) | Split: keep extract; soft-flag chat |
| **`aiCorrections.ts`** + context | Correction CRUD / prompt injection | **Keep** (flywheel) |
| **`aiMemory.ts`** + context + health | Facility knowledge + health repairs | **Keep** with guardrails |
| **`countObservation.ts`** | Vision/count observation | Propose-only; not release authority |
| **`inventory.ts`** (AI match prompts) | Item match on intake | Keep match; human confirm |

Also: cost limit middleware, rate-limit integration tests, retained-AI capability registration.

### 2.2 Shared libraries

| Lib | Role | Research link |
|-----|------|----------------|
| **`integrations-openai-ai-server`** | Gemini behind OpenAI-shaped `pickModel` | Dual-mode / hybrid adapter target |
| **`ai-evaluation`** | Versioned evaluation manifests | Phase-0 gate artifact |
| **`ai-memory`** | Corrections + facility knowledge + conversation + health | Distill labels + prompt enrichment |

### 2.3 Adapter facts (unchanged)

- Provider: **Gemini** (`gemini-3.6-flash` for cheap + full)
- Surface: `openai.chat.completions.create`
- Sharp edges: thinking-token starvation, JSON MIME mapping, vision = data URI, mocks must export `pickModel`
- **Readiness still hard-depends on AI key** in `health.ts` → plant-down risk

---

## 3. Deep dig: `lib/ai-memory` (under-researched until now)

Three **separate** memory systems share one package:

### A. Name corrections (highest value for extract quality)

- Mapping: messy name → canonical (`domain`: ingredient / brand / flavor / die / item)
- Injected into **every** name-resolving AI prompt via `buildCorrectionsBlock`
- Hygiene: `normalizeCorrections`, `dropConflictingCorrections`, `collapseChains` (cycles deleted; chains collapsed to terminal)
- Cap: default 200 in prompt

**Why it matters for our AI plan:**  
This is the **human-in-the-loop flywheel** that improves extraction *without* fine-tuning. Every Apply that teaches a name should feed corrections; verified corrections are also **candidate distill labels** (fromText/toText domains).

### B. Facility knowledge (operational facts)

- Durable plain-language facts (`domain` + stable `key` + `fact`)
- Rendered as “FACILITY MEMORY” block into prompts
- Sanitized against newline injection / domain spoofing
- Cap: default 80 in prompt

**Risk vs Phase E:** Useful background; must not become QC/release authority or invent inventory numbers. Prefer facts that are **operational context**, not live calc.

### C. Per-user conversation memory

- Rolling window (~20 turns retained, ~12 in prompt)
- Powers chat-style assistants

**Portfolio:** Chat is in the **simplify/retire** column for floor primary UX. Memory can stay for optional surfaces but should not drive day-state writes.

### D. Memory health (manager repair)

- Statuses: duplicate, cycle, chain, outdated-target, orphaned, etc.
- Safe repairs: delete / retarget only for clear cases
- Pure analysis → API applies in transaction

**Research takeaway:** Memory health is production-grade. Distillation and Phase-0 should **reuse** correction identity rules rather than invent parallel alias stores.

---

## 4. Map memory → research workstreams

| Workstream | How `ai-memory` helps | What to build next |
|------------|----------------------|--------------------|
| Extraction quality (now) | Corrections in every match/extract prompt | Ensure Apply → correction write path is complete; health job on schedule |
| Distill dataset (later) | Apply + deterministic agreement labels | Join Apply logs with correction keys for verified examples |
| Phase-0 | Same prompts with/without local model | Freeze correction pool snapshot in eval manifest dependencies |
| Soft readiness | Independent of memory | Still P0 ops |
| Chat / schedule AI | Conversation + knowledge blocks | Feature-flag; do not expand |

---

## 5. Spec-parse prompt (core AI product)

From `aiParseSpecSheet.ts` (partial):

- Input: Excel flattened to **tab-separated text**
- Output: **SPEC PROFILES** (brand+flavor) + cheese/topping applicators (type + oz/pizza, …)
- Strong brand-matching rules (qualified product-line brands must not collapse onto shorter KNOWN brands)
- Regression tests for compound “Brand Size DOUGH” rows and `targets` population

**This is the teacher prompt to pin** for any future distillation (`PINNED_PRODUCTION_EXTRACT_SYSTEM_PROMPT` in the Unsloth pack).

---

## 6. Ranked “more research” digs (ordered)

### Already enough theory — execute next

1. **Soft readiness** — code change, not research  
2. **Phase-0 harness** — run Gemini vs local on corpus using `ai-evaluation`  
3. **Wire distill-dataset** into monorepo + backfill from Apply/corrections  

### Worth more research (code-grounded)

| # | Topic | Why | Method |
|---|--------|-----|--------|
| **R1** | **Correction → extract closed loop** | Highest ROI without GPU | Trace Apply paths → `aiCorrections` writes; gap list |
| **R2** | **Cost limit + rate limit behavior under Gemini** | Cost/ops | Read `costLimitMiddleware`, weighted limiters; document budgets per route class |
| **R3** | **Reviewed document extraction path** | `ai.ts` adapters (`workbookTextAdapter`, `specImagesAdapter`) | Map review/apply gates vs silent writes |
| **R4** | **Vision / count observation** | QC risk | Confirm propose-only; no auto release |
| **R5** | **Replit vs main AI delta** | Primary is replit | Diff AI routes / models / readiness on replit branch tip |
| **R6** | **Eval corpus location & CI wiring** | Phase-0 prerequisite | Find harness entrypoints, golden files, SPEC_PARSE version |

### Defer research

- New agent frameworks  
- RAG over full day-state  
- Fine-tune until Phase-0 fails  
- Bloom filters at current corpus size (Jaccard is enough)

---

## 7. Updated recommendation (unchanged spine, richer middle)

```text
P0  Soft readiness (AI key ≠ plant down)
P0  Freeze/flag non-extract chat & schedule-optimize surfaces
P1  Correction-loop audit (R1) — every Apply teaches the pool
P1  Phase-0: Gemini baseline vs local on pinned corpus
P2  Dual-mode adapter when/if Phase-0 is green or hybrid needed
P2  Distill-dataset backfill from Apply + corrections (labels only)
P3  QLoRA only if local base loses Phase-0 by a clear margin
```

**Memory package is a strength:** treat it as first-class infrastructure for extraction quality, not as a reason to expand chat AI.

---

## 8. Suggested next single dig

**R1 — Correction → extract closed loop**

Deliverable:

1. Sequence diagram: staff Apply / match confirm → DB correction row → next `buildCorrectionsBlock` in parse/match prompts  
2. Gaps (routes that match names but never write corrections)  
3. Minimal patch list for Replit  

That improves production AI **this week** without local GPU, distillation, or readiness risk.

---

*Continuation 2026-09-29 — codebase-mapped AI inventory, ai-memory deep dig, ranked next research.*
