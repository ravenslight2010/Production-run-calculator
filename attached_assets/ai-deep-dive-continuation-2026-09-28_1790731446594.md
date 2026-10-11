# AI Deep-Dive Continuation — Local, Distillation, Hybrid

**Date:** 2026-09-28  
**Inputs:**  
`how-to-build-ai-research-2026-09-28.md` · `ai-tailored-to-app-research-2026-09-28.md` · `how-to-build-an-ai-research-2026-09-28.docx` · `local-ai-installation-research-2026-09-26.docx` · `distillation-experiment-design-2026-09-28.docx`

**Question:** Keep digging — what do 2026 benchmarks, pricing, and architecture patterns say about Option B (self-hosted), the distillation trigger, and hybrid routing for this app?

---

## 1. Structured-output reality check (the only metric that matters)

Spec-parse is **value accuracy inside a schema**, not “valid JSON.”

| Finding (2026 literature) | Implication for PRC |
|---------------------------|---------------------|
| JSON Pass often >95% while Value Accuracy is 15–30 points lower | Do not celebrate “it returned JSON.” Gate on **field-level discrepancy vs gold** (your corpus harness already does this). |
| Prompting strategy often beats raw model size for structure | Keep production system prompt + schema **byte-identical** in training and inference (distillation memo §3.5). |
| Mid-size open models (Qwen3.5-35B, GLM-4.7) can match or beat frontier on **text Value Accuracy** in some SOB-style boards | Local is *plausible* for text extraction; not automatic. |
| Vision structured output lags text hard (Value Acc drops ~0.80 → ~0.55–0.67 in multi-modality boards) | Spec **photo** path stays on Gemini (or a strong VL) longer than workbook text path. |
| Grammar / JSON-schema constraints (Ollama `format`, llama.cpp grammars, Outlines) push structural validity → ~100% | Use constraints **plus** quality eval — constraints fix parse failures, not wrong field values. |

**Takeaway:** Option B Phase-0 is still the right gate. Public leaderboards do **not** substitute for `lib/corpus-harness` on *your* workbooks.

---

## 2. Candidate local models for *this* workload

Aligned with local-AI + distillation docs (Qwen family + Ollama path):

| Role | Candidate | Why | Risk |
|------|-----------|-----|------|
| Text extract (primary) | **Qwen3 8B / 14B** (Q4) | Strong open structured-output lineage; fits 24GB; distillation student target | May trail Gemini on messy multi-sheet semantics |
| Text extract (stronger local) | **Qwen3.5 35B** or **Gemma-3 27B** Q4 | Closer to frontier on some value-acc boards | Needs ~20–24GB+; higher $/hr if rented always-on |
| Vision (spec photo / stock) | **Qwen2.5-VL 7B** / Gemma-3 multimodal | Open VL baseline | Expect larger gap vs Gemini; hybrid longer |
| Cheap tier (name match) | Qwen3 0.6B–1.7B or **skip LLM** | Deterministic matcher + alias memory already strong | Marginal ROI |

**Do not** put a 1–3B browser model on the retained 5/5 extraction path (local-AI research Option A — still correct).

---

## 3. Hosting economics (always-on next to Render)

Render web instances remain **unsuitable** for GPU models (no GPU, tight RAM). Separate host required.

### Approximate 2026 market (on-demand / marketplace)

| GPU | Typical VRAM | On-demand $/hr (order of magnitude) | ~Monthly 24/7 |
|-----|--------------|-------------------------------------|---------------|
| RTX 3090 / 4090 class | 24GB | $0.15–0.40 | **~$110–300** |
| A10 / L4 class | 24GB | $0.20–0.70 | **~$150–500** |
| A100 40/80GB | 40–80GB | $0.50–1.50 | **~$350–1100** |
| H100 80GB | 80GB | $1.50–2.50+ | **~$1100–1800+** |

**Practical floors for PRC:**

| Deploy shape | Hardware | Monthly ballpark | Fits |
|--------------|----------|------------------|------|
| **Plant mini-PC / used workstation** | 1× 24GB (4090/3090) | Power + once hardware | Best TCO if facility can host |
| **Cheap always-on cloud** | 1× 24GB marketplace | ~$150–300 | Qwen3-8B Q4 + headroom |
| **Quality headroom** | 1× A100 40/80 | ~$400–900 | 14B–32B class |
| **Train-only (spot)** | A100 few hours | **$1–15** per QLoRA run | Distillation experiment |

**Break-even vs Gemini:** only matters if import volume × API $ exceeds host cost **and** quality gate passes. For low daily import volume, **stability** (no more model-id 404 outages) and **privacy** may justify the host before pure $ break-even.

---

## 4. Hybrid architecture (recommended default, not pure local day-one)

Matches adapter seam (`OpenAI`-shaped client) + production practice (LiteLLM / gateway patterns):

```text
pickModel("cheap" | "full")
        │
        ▼
┌───────────────────┐
│  AI adapter       │  LOCAL_AI_BASE_URL + optional CLOUD_FALLBACK
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
 Local Ollama   Gemini (or frontier)
 (text parse,   (vision, hard cases,
  matching)      fallback on local fail)
```

| Route | Primary | Fallback |
|-------|---------|----------|
| Spec workbook extract | Local (after Phase-0 pass) **or** Gemini until pass | Gemini |
| Spec photo / stock vision | Gemini | — |
| Unresolved name match | Deterministic → optional tiny local | — |
| Provider down | Soft AI-ready; core app stays up | Documented readiness split |

**Implementation notes:**

- One adapter module swap (already in local-AI research Phase 1).  
- Fallbacks at **request** level (gateways do not migrate conversation state — irrelevant for one-shot extract).  
- Keep circuit breaker **only** on AI client, never on sync.  
- Readiness: `ai-ready` = local host healthy **or** cloud key present (product choice); core `readyz` independent.

This is the same “Ollama-first + cloud insurance” pattern used in 2026 hybrid agent stacks — adapted to **extract-only**, not agents.

---

## 5. Distillation path — still conditional, but dataset work is not

Reconcile tailored doc (“fine-tune low priority for now”) with distillation memo:

| Work | When | GPU? |
|------|------|------|
| Dataset flywheel (verified Apply + deterministic agreement) | **Now** (Phase E extraction quality) | No |
| Brand-group split + near-dup CI + private manifest | **Now** | No |
| QLoRA train qwen3:8b on teacher outputs | **Only if** Phase-0: local base trails Gemini beyond tolerance | Yes (~$1–15) |
| Never-look holdout gate + SPEC_PARSE_VERSION bump | Before any merge | Eval only |

### Sequence-level distillation remains the right method

- Logit KD needs teacher distributions → not available from Gemini API at scale.  
- Sequence-level SFT on schema-conformant teacher JSON matches corpus harness shape.  
- 2026 practice: QLoRA r=16–64, lr ~1e-4–2e-4, 2–3 epochs; **template alignment** (`add_generation_prompt` match train/serve) is a known footgun — pin production chat template.

### Combined with constrained decoding

Best production pattern for structured extract:

1. Fine-tune (or strong base) for **value** accuracy.  
2. Ollama JSON schema / grammar for **structural** validity.  
3. Zod validate on API boundary (already in stack).  
4. Human Apply only (portfolio rule).

Fine-tune alone ≠ 100% schema; grammar alone ≠ correct fields. Use both.

---

## 6. Updated decision tree (actionable)

```text
[Now]
  ├─ Implement AI soft readiness (core up without provider)
  ├─ Freeze/retire non-audit AI surfaces (Phase E)
  ├─ Expand extraction golden set + correction → verified train candidates
  └─ Phase-0: Ollama + qwen3:8b/14b on corpus vs Gemini baseline
        │
        ├─ Local within tolerance → Adapter to local primary, Gemini fallback
        │                            (optional later: distill to lock form)
        │
        └─ Local trails → Keep Gemini primary
                          ├─ Continue dataset curation
                          └─ Trigger QLoRA only when gap is clear and stable
```

**Abort fine-tune** if student cannot beat **same base model with better prompt/schema** — then the bottleneck is not weights.

---

## 7. What not to dig further (for this product)

| Topic | Why stop |
|-------|----------|
| From-scratch pre-training | Ruled out in build memo |
| In-browser WebLLM for full extract | Quality + device fleet (local-AI Option A) |
| Broad agents / day chat | Audit Retire + tailored rank X |
| Fine-tuning facts (inventory, prices) | RAG/DB domain; catastrophic forgetting risk |
| Render co-located GPU | Platform constraint |

---

## 8. Concrete “dig next” backlog (engineering, not more theory)

1. **Phase-0 script** — one command: run corpus harness against `LOCAL_AI_BASE_URL` models listed above; emit discrepancy table vs Gemini baseline.  
2. **Dataset v0** — manifest-only in repo; verified examples from Apply logs + deterministic agreement.  
3. **Adapter dual-mode** — `AI_PROVIDER=local|gemini|hybrid` with health probes.  
4. **Host TCO sheet** — plant PC vs Vast/RunPod 24GB always-on vs A100 (fill real quotes).  
5. **Vision deferral note** — explicit: photo routes stay cloud until VL corpus exists.

---

## 9. One-paragraph executive update

Public 2026 structured-output boards show open mid-size models are **competitive on text value accuracy**, so Option B is worth the Phase-0 benchmark — but **value accuracy ≠ JSON parse rate**, and vision still lags. Always-on local inference is roughly **$150–300/mo** on a 24GB card (or near-zero incremental if a plant GPU PC exists); training a student remains a **weekend + <$50** experiment. The correct product posture is **hybrid**: harden extraction evals and soft readiness now; promote local only after the corpus gate; distill only if the base local model loses that gate. Agents and browser models remain off the critical path.

---

*Continuation research 2026-09-28 — digs into quality, cost, hybrid, and distillation triggers without reopening retired portfolio items.*
