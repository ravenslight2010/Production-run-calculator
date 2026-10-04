# QLoRA Distillation Techniques — Exploration for Spec-Parse

**Date:** 2026-09-28  
**Scope:** Practical techniques for distilling a frontier teacher (Gemini) into a local student (Qwen3-class) via QLoRA, for **structured JSON extraction**.  
**Constraint:** Only relevant if Phase-0 shows local base trailing Gemini. Dataset curation can start now; training waits on that gate.

---

## 1. Two families of distillation (pick one)

| Family | What the student learns | Needs from teacher | Fit for PRC |
|--------|-------------------------|--------------------|-------------|
| **Sequence-level (response) distillation** | Teacher’s full text outputs as SFT targets | Text only (API OK) | **Primary choice** — Gemini is black-box API |
| **Logit-level (white-box) KD** | Soft token distributions / top-K logits | Same tokenizer + logits access | Poor fit — Gemini API does not expose full logits; vocab mismatch with Qwen |

**Decision:** Use **sequence-level distillation** = supervised fine-tuning (SFT) on verified teacher outputs. Optionally add a light preference stage later; start with SFT only.

2026 practice note: for **strict structured tasks** (JSON schema, function-style fields), SFT alone often beats SFT+RL — RL helps more on open-ended generation than on constrained forms.

---

## 2. What QLoRA actually does

- Base weights stay **frozen in 4-bit** (NF4 + double quant common).  
- Train tiny **LoRA adapters** (typically 0.1–1% of parameters) in higher precision.  
- At serve time: merge adapter into GGUF/Ollama, or load base + adapter.  
- Catastrophic forgetting is **much lower** than full fine-tune (adapters constrain drift), which matches “lock form, keep general ability.”

---

## 3. Technique stack (recommended order)

### A. Data (the real lever)

1. **Teacher generation** — Gemini with production system prompt + `response_format` / JSON mode.  
2. **Verification filter** (anti-poison):
   - Deterministic import agreement on critical fields, **or**
   - Human **Apply** in review UI  
3. **Format** — chat JSONL, production template:
   ```json
   {"messages": [
     {"role": "system", "content": "<exact production extract prompt>"},
     {"role": "user", "content": "<workbook chunk>"},
     {"role": "assistant", "content": "<schema JSON only>"}
   ]}
   ```
4. **Loss masking** — train on **assistant tokens only** (`completion_only_loss` / response-only). Never backprop into the system+user prompt.  
5. **Template alignment** — train and serve with the **same** chat template (`add_generation_prompt=True` on both). Mismatch is a common cause of “explanatory text instead of JSON.”  
6. **Scale** — 1.5k–5k verified examples is the practical small-team band for form-locking; quality > quantity.

### B. QLoRA hyperparameters (2026 consensus starting point)

| Knob | Structured-extract start | Notes |
|------|--------------------------|--------|
| **Rank r** | **32–64** | Form/schema tasks need more capacity than style-only (r=8–16). Start 32; go 64 if underfit. |
| **Alpha** | **2 × r** (64–128) | Standard scale; alpha/r ≈ 2 |
| **Target modules** | All linear: q,k,v,o + gate,up,down | Attention-only underperforms |
| **Dropout** | 0–0.05 | 0 is fine with Unsloth; small dropout if overfitting |
| **LR** | **1e-4 – 2e-4** | Classic QLoRA band; if loss spikes, drop to 5e-5–1e-4 |
| **Epochs** | **1–2** (max 3) | Structured SFT overfits fast; prefer more data over more epochs |
| **Warmup** | 5–10% | Cosine schedule common |
| **Effective batch** | 8–32 | grad_accum as needed for VRAM |
| **Max seq** | Fit longest workbook chunk + JSON | Measure corpus; packing=false if lengths vary a lot |
| **Quant** | 4-bit NF4, double quant, bf16 compute | Unsloth/bitsandbytes defaults |

### C. Tooling

| Tool | Role |
|------|------|
| **Unsloth** | Fastest path: 2–5× speed, lower VRAM, Qwen3 notebooks, export to GGUF/Ollama |
| **TRL SFTTrainer** | Standard; `completion_only_loss=True` |
| **PEFT LoraConfig** | Explicit r/alpha/targets if not using Unsloth helpers |
| **Ollama / llama.cpp** | Serve merged or adapter-backed model behind `LOCAL_AI_BASE_URL` |

### D. Optional second stage (only if SFT plateaus)

| Method | When | Caution |
|--------|------|---------|
| **DPO / preference** | Have clear preferred vs rejected JSON (e.g. Apply vs rejected proposal) | Needs pairs; more ops |
| **RL-Struct / GRPO-style** | Want extra structural reward (valid JSON, required keys) | 2026 evidence: **SFT often enough** for strict schema; RL helps open generation more |
| **Logit GKD (Unsloth GKDTrainer)** | Teacher is **local** same-family model | Not available from Gemini API |

For PRC: **stop at verified SFT** unless Phase-0 after SFT still fails structural gates.

---

## 4. End-to-end recipe (conditional on Phase-0 fail)

```text
1. Curate ≥1,500 verified examples (Apply + deterministic agreement)
2. Brand-group split → train / dev / never-look holdout
3. Rent or use local 24GB (4090) or A100:
     Unsloth + Qwen3-8B-Instruct 4-bit
     r=32–64, alpha=2r, LR=2e-4, 1–2 epochs, response-only loss
4. Eval on dev with same metrics as Phase-0 (field agreement, blank-poison)
5. Holdout once → go/no-go
6. Export GGUF → Ollama → LOCAL_AI_BASE_URL
7. Bump SPEC_PARSE / cache version; keep Gemini hybrid fallback
```

**Cost/time:** typically **a few hours + $1–15** GPU, not a research project.

---

## 5. Failure modes specific to structured distillation

| Failure | Symptom | Fix |
|---------|---------|-----|
| Template train/serve mismatch | Prose before JSON, markdown fences | Pin chat template; response-only loss |
| Label noise from teacher | Student copies Gemini field errors | Verification filter; quarantine rejects |
| Overfit to brand layouts | Holdout brands collapse | Brand-group split; never-look holdout |
| Blank / null fields | Looks like wipe templates | Hard fail metric; reject from train set |
| Underfit schema | Valid JSON, wrong keys | Raise r; more diverse nested examples; ensure system prompt identical |
| Forgetting general ability | Rare with LoRA; check with small general probe | Keep r moderate; don’t full-FT |

---

## 6. What *not* to optimize early

- Logit KD against Gemini (not available)  
- Multi-agent / CoT traces in the target (unless eval proves student needs “why”)  
- RL before a strong SFT baseline  
- Training on unverified raw teacher dumps  
- Rank sweeps before data quality is solid  

---

## 7. Mapping to Production Run Calculator

| PRC asset | Distillation use |
|-----------|------------------|
| Gemini + production extract prompt | Teacher |
| Corpus harness + `lib/ai-evaluation` | Gate metrics |
| Human Apply + correction memory | Verified labels |
| `integrations-openai-ai-server` adapter | Student inference after export |
| protectRunValues / blank templates | Blank-poison hard fail |
| Phase-0 decision | **Trigger** for this whole path |

**Still true:** do not start QLoRA training until Phase-0 shows a real quality gap. Dataset flywheel work is the productive use of time until then.

---

## 8. One-page cheat sheet

```
Method:     Sequence-level SFT (not logit KD)
Student:    Qwen3-8B (or 14B) 4-bit QLoRA
Rank/Alpha: 32–64 / 2×r
LR/Epochs:  1e-4–2e-4 / 1–2
Loss:       Assistant tokens only
Data:       Verified Apply ∪ deterministic agreement only
Eval:       Same field metrics as Phase-0 + blank-poison = 0
Serve:      Ollama OpenAI-compatible → existing adapter
Abort:      Student ≤ well-prompted base → fix prompt/schema, don’t train more
```

---

*Exploration 2026-09-28 — QLoRA + sequence distillation techniques tailored to structured extraction and the app’s teacher/student constraints.*
