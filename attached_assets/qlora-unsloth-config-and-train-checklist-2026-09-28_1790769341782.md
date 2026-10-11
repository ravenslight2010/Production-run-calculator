# Unsloth Config + JSONL Schema + Train-Safety Checklist

**Date:** 2026-09-28  
**For:** Sequence-level QLoRA distillation of spec/workbook extract (conditional on Phase-0)  
**Pairs with:** `qlora-distillation-techniques-2026-09-28.md` · `ai-phase0-adapter-dataset-design-2026-09-28.md`

---

## Part A — JSONL schema (train / dev / holdout)

### A.1 One training line (chat format)

```json
{
  "id": "brandA-spec-014-chunk03",
  "partition": "train",
  "brandCode": "brandA",
  "verified": "human-apply",
  "schemaVersion": 40,
  "contentSha256": "abc123...64hex",
  "messages": [
    {
      "role": "system",
      "content": "PINNED_PRODUCTION_EXTRACT_SYSTEM_PROMPT"
    },
    {
      "role": "user",
      "content": "<<redacted workbook chunk text or structured sheet dump>>"
    },
    {
      "role": "assistant",
      "content": "{\"productName\":\"...\",\"cartonSize\":12,\"casesPerHour\":null,\"flavor\":\"...\"}"
    }
  ]
}
```

**Rules:**

| Field | Rule |
|-------|------|
| `system` | **Byte-identical** to production extract system prompt (copy from the live route, not a paraphrase) |
| `assistant` | **JSON only** — no markdown fences, no “Here is the JSON:”, no trailing prose |
| `verified` | One of: `human-apply` \| `deterministic-agreement` \| `both` |
| `partition` | `train` \| `dev` \| `holdout` — brand never appears in two partitions |
| `schemaVersion` | Matches production parse version / cache invalidation number |

### A.2 Manifest-only row (safe for git)

```json
{
  "id": "brandA-spec-014-chunk03",
  "partition": "train",
  "brandCode": "brandA",
  "verified": "human-apply",
  "schemaVersion": 40,
  "contentSha256": "abc123...64hex",
  "source": "apply-log",
  "createdAt": "2026-09-28T00:00:00Z"
}
```

Raw `messages` live in a **private** store; repo keeps hashes + metadata only (same privacy discipline as `lib/ai-evaluation`).

### A.3 Assistant content shape

- Must parse with the **same Zod/schema** production uses after extract.  
- Prefer `null` over inventing missing fields (matches protect / blank-guard thinking).  
- Critical fields (whatever feeds inventory + `protectRunValues` — e.g. cartonSize, cases, line identifiers) must be present when gold has them.

---

## Part B — Concrete Unsloth + TRL config

Pin the real production system prompt before any run. Student default: **Qwen3-8B-Instruct**.

### B.1 Environment (sketch)

```bash
# 24GB class GPU (4090 / A10) or cloud rental
pip install "unsloth[colab-new]"  # or current Unsloth install docs
# torch, trl, peft, bitsandbytes pulled by Unsloth
```

### B.2 Training script core

```python
# distill_spec_parse_qlora.py — sketch; pin paths and prompt before use
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig
from datasets import load_dataset
import json

MAX_SEQ_LENGTH = 4096  # measure your longest chunk+JSON; raise if needed
STUDENT = "unsloth/Qwen3-8B-Instruct"  # or official Qwen3-8B-Instruct + 4bit

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=STUDENT,
    max_seq_length=MAX_SEQ_LENGTH,
    load_in_4bit=True,
    dtype=None,  # Unsloth picks
)

model = FastLanguageModel.get_peft_model(
    model,
    r=32,                    # try 64 if underfit on nested fields
    lora_alpha=64,           # 2 * r
    lora_dropout=0.05,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)

# Private JSONL: one object per line with "messages" key (Part A)
dataset = load_dataset("json", data_files="private/train.jsonl", split="train")

def formatting_func(example):
    # Must match production / Ollama serve template
    return tokenizer.apply_chat_template(
        example["messages"],
        tokenize=False,
        add_generation_prompt=False,  # full turn already includes assistant
    )

# Prefer response-only loss when TRL/Unsloth version supports it
train_args = SFTConfig(
    output_dir="outputs/spec-parse-qlora",
    per_device_train_batch_size=2,
    gradient_accumulation_steps=8,   # effective batch 16
    learning_rate=2e-4,
    num_train_epochs=2,
    warmup_ratio=0.05,
    lr_scheduler_type="cosine",
    logging_steps=10,
    save_strategy="epoch",
    bf16=True,
    optim="adamw_8bit",
    seed=3407,
    max_seq_length=MAX_SEQ_LENGTH,
    # completion_only_loss=True,  # enable if your TRL version exposes it
    packing=False,
    report_to="none",
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    formatting_func=formatting_func,
    args=train_args,
)

trainer.train()

# Save adapter
model.save_pretrained("outputs/spec-parse-qlora/adapter")
tokenizer.save_pretrained("outputs/spec-parse-qlora/adapter")

# Optional: merge + GGUF for Ollama (Unsloth helpers)
# FastLanguageModel.for_inference(model)
# model.save_pretrained_gguf("outputs/spec-parse-gguf", tokenizer, quantization_method="q4_k_m")
```

### B.3 Hyperparameter quick reference

| Setting | Value | If problem |
|---------|-------|------------|
| r / alpha | 32 / 64 | Underfit nested JSON → 64 / 128 |
| LR | 2e-4 | Loss spikes / NaN → 1e-4 then 5e-5 |
| Epochs | 2 | Dev field-agreement drops after epoch 1 → stop at 1 |
| Effective batch | 16 | OOM → batch 1, accum 16 |
| Max seq | ≥ longest example | Truncation destroying JSON → raise or chunk inputs |

### B.4 Serve after train

1. Export GGUF or load adapter in Ollama.  
2. Point `LOCAL_AI_BASE_URL=http://host:11434/v1`.  
3. Set `AI_PROVIDER=hybrid` (or `local`) in the dual-mode adapter.  
4. Re-run **Phase-0** metrics on the student — holdout once.  
5. Bump parse/cache version so old cached extracts are not mixed with new model output.

---

## Part C — “Safe for train?” checklist

Run **every** candidate example through this before it enters `train.jsonl`.

### C.1 Hard rejects (never train)

- [ ] Assistant content is **not** valid JSON (parse fails)  
- [ ] Contains markdown fences or leading/trailing prose  
- [ ] Would set a **protected / critical field to blank** when gold is non-blank (blank-poison)  
- [ ] Invents numbers not present in the user chunk (hallucinated cases, cartonSize, rates)  
- [ ] Failed human review / was **rejected** on Apply  
- [ ] Deterministic path **disagrees** on critical fields and no human Apply  
- [ ] Duplicate / near-duplicate of a **holdout or dev** input (sim > ~0.85)  
- [ ] Brand already reserved for another partition  

### C.2 Accept only if one of these holds

- [ ] **Human Apply:** proposal was accepted in review UI (log has who/when), **or**  
- [ ] **Deterministic agreement:** non-AI import path produced the same critical field values  

Prefer `verified: "both"` when available.

### C.3 Soft quality (prefer fix or quarantine)

- [ ] System prompt is exact production pin (not a “similar” rewrite)  
- [ ] User chunk redacted of supplier prices/contacts if policy requires  
- [ ] Schema version matches current production  
- [ ] Nested structures that appear in production are represented (not only flat toy JSON)  
- [ ] `null` used for unknown rather than empty string or `"N/A"` (match production convention)

### C.4 Decision stamp

```text
id: ...
brandCode: ...
verified: human-apply | deterministic-agreement | both
critical_fields_ok: yes/no
blank_poison: yes/no
partition: train | quarantine
reviewer: ...
date: ...
```

Quarantine ≠ delete: keep for later human triage; do not SFT on it.

---

## Part D — Minimal pipeline wiring

```text
Apply log / corpus snapshot
        │
        ▼
[Checklist C] ──reject──► quarantine/
        │ accept
        ▼
private/train.jsonl  +  git manifest (hashes only)
        │
        ▼
Unsloth QLoRA (Part B) ── only if Phase-0 gap exists
        │
        ▼
Ollama / LOCAL_AI_BASE_URL
        │
        ▼
Phase-0 metrics + holdout gate
        │
        ▼
hybrid adapter / version bump
```

---

## Part E — Reminder

This config and checklist **do not** change the product order:

1. Soft readiness  
2. Phase-0 measurement  
3. Grow verified dataset with **Part C**  
4. Train with **Part B** only if local base loses Phase-0  

Do not start a GPU job until steps 1–2 are done and you have ≥ ~1,500 checklist-passed examples.

---

*Concrete artifacts 2026-09-28 — Unsloth/JSONL sketch + train-safety checklist for Production Run Calculator extract distillation.*
