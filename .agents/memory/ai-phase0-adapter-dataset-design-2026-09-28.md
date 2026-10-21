# Phase-0 Benchmark, Dual-Mode Adapter & Dataset Design

**Date:** 2026-09-28  
**Repo tip reviewed:** `main` @ `0623f50e`  
**Grounded in:**  
`lib/integrations-openai-ai-server` · `lib/ai-evaluation` · `lib/ai-memory` · `.agents/memory/ai-model-routing-and-streaming.md` · `artifacts/api-server/src/routes/health.ts` · prior AI research packs

---

## 1. What the codebase already gives you

| Asset | Location | Role |
|-------|----------|------|
| OpenAI-shaped surface | `lib/integrations-openai-ai-server/src/client.ts` | `openai.chat.completions.create({ model, messages, response_format, max_completion_tokens, stream? })` |
| Model routing | `src/models.ts` → `pickModel("cheap"\|"full")` | Both tiers currently `gemini-3.6-flash` |
| Provider | Gemini via Replit integration **or** `GOOGLE_API_KEY` | Not OpenAI despite package name |
| Eval manifest contract | `lib/ai-evaluation` | Versioned manifest: corpus sha256, thresholds, provider identity, privacy mode, pass/fail |
| Correction / memory | `lib/ai-memory` | Flywheel for verified corrections |
| Hard readiness on AI key | `health.ts` `dependencies` check | Missing key → **503** on `/readyz` (known uptime issue) |

**Implication:** Dual-mode and Phase-0 should extend the **adapter + pickModel + evaluation manifest** path — not invent a parallel AI stack.

---

## 2. Phase-0 benchmark design (decision gate)

### 2.1 Goal

Answer one question with numbers:

> Does a local OpenAI-compatible model (Ollama) meet the **same acceptance contract** as current Gemini on the **retained spec-import corpus**, within agreed tolerance?

If **yes** → promote hybrid (local primary for text extract).  
If **no** → keep Gemini; continue dataset curation; distill only if gap is stable and large enough.

### 2.2 What to measure (not JSON parse rate alone)

Prefer field-level metrics already implied by import quality work:

| Metric | Definition | Why |
|--------|------------|-----|
| **Schema valid rate** | Zod/JSON parse success after model output | Structural floor |
| **Field agreement rate** | Exact match vs gold on critical fields (brand, flavor, cartonSize, cases, line speed, key recipe fields) | Value accuracy |
| **Critical-field agreement** | Subset weighted (fields that feed inventory / protectRunValues) | Safety |
| **Blank-poison rate** | Outputs that would look like server blank template / wipe populated runs | Protect alignment |
| **Latency p50/p95** | End-to-end extract | Floor UX |
| **Empty / MAX_TOKENS rate** | Empty content (known Gemini thinking-budget class of failure) | Reliability |

Use `lib/ai-evaluation` manifest shape for the run artifact:

- `evaluation.kind`: `"provider-backed"`
- `provider`: `{ identityState: "identified", name: "ollama"|"gemini", model: "<id>" }`
- `corpus.sha256` + `cases` bound to the same harness snapshot for both sides
- `thresholds`: explicit numbers (see §2.4)
- `privacy.mode`: `"metadata-only"` for CI evidence (no raw workbooks in public artifacts)

### 2.3 Protocol

```text
1. Freeze corpus snapshot (sha256) used for Gemini baseline (PR #81 era or current main).
2. Run harness through production adapter against Gemini → baseline report.
3. Point adapter at LOCAL_AI_BASE_URL (Ollama OpenAI-compatible /v1).
4. Map pickModel:
     cheap → qwen3:8b (or 14b if VRAM allows)
     full  → same or stronger local for extract routes under test
5. Identical system prompts + response_format json_object (or Ollama json schema).
6. Emit two EvaluationManifests + a comparison (lib/ai-evaluation comparison helpers).
7. Decision table (§2.4).
```

**Routes in scope for Phase-0 (text):**

- Spec/workbook extract path only (highest audit value)  
- Optionally `match-import` / `match-premix` / `fill-missing` as **cheap** tier smoke  

**Out of scope for Phase-0:**

- Vision (spec photo, stock intake) — stay Gemini  
- Chat/ask/recipe-assistant streams — portfolio retire/simplify  

### 2.4 Suggested pass thresholds (starting point — tune once baseline measured)

| Gate | Pass if local is… |
|------|-------------------|
| Schema valid | ≥ baseline − 1 pp (or ≥ 99% absolute) |
| Critical-field agreement | ≥ baseline − **3 pp** |
| Overall field agreement | ≥ baseline − **5 pp** |
| Blank-poison | **0** cases (hard fail) |
| Empty output rate | ≤ baseline + 1 pp |
| p95 latency | Informational only for Phase-0 (not a hard fail unless unusable) |

**Hard fail (abort local promotion):** any blank-poison; critical-field gap > 5 pp; or systematic missing required fields.

Document actual baseline numbers in the evaluation evidence before debating thresholds.

### 2.5 Deliverable

One CI-friendly command (sketch):

```bash
pnpm --filter @workspace/ai-evaluation exec phase0-benchmark \
  --corpus <snapshot> \
  --provider gemini \
  --provider ollama --base-url "$LOCAL_AI_BASE_URL" --model qwen3:8b
```

Outputs: two manifests + comparison JSON + human summary table.

---

## 3. Dual-mode adapter design (fits existing client.ts)

### 3.1 Env contract

| Variable | Meaning |
|----------|---------|
| `AI_PROVIDER` | `gemini` (default) \| `local` \| `hybrid` |
| `LOCAL_AI_BASE_URL` | e.g. `http://gpu-host:11434/v1` |
| `LOCAL_AI_API_KEY` | optional; Ollama often ignores |
| `LOCAL_AI_MODEL_CHEAP` / `LOCAL_AI_MODEL_FULL` | override `AI_MODELS` when local |
| Existing | `AI_INTEGRATIONS_GEMINI_*`, `GOOGLE_API_KEY`, `OPENAI_API_KEY` (legacy) |

### 3.2 Behavior by mode

| Mode | `pickModel` resolves to | create() backend |
|------|-------------------------|------------------|
| `gemini` | `AI_MODELS` gemini ids | Current `GoogleGenAI` path |
| `local` | `LOCAL_AI_MODEL_*` | OpenAI SDK or fetch → `LOCAL_AI_BASE_URL/chat/completions` |
| `hybrid` | Prefer local for `cheap` + text extract; Gemini for `full` vision/chat; on local failure → Gemini once | Both clients |

**Hybrid failure policy (request-level):**

1. Try local with timeout (e.g. 60s extract).  
2. On network/5xx/empty content → one Gemini retry.  
3. Log `provider_attempted`, `provider_used`, latency.  
4. Never await this inside `upsertProtected`.

### 3.3 Code shape (minimal change)

Keep the public export:

```ts
export const openai = { chat: { completions: { create } } };
export { pickModel, AI_MODELS };
```

Internally:

```text
create(params)
  → resolveBackend(params.model, AI_PROVIDER)
  → geminiCreate | localOpenAICreate
```

`localOpenAICreate`: map the same `ChatMessage[]` / `response_format` / `max_completion_tokens` to standard OpenAI JSON body (Ollama-compatible). No Gemini thinkingConfig on local path.

**Tests:** every `vi.mock("@workspace/integrations-openai-ai-server")` must still export `pickModel` + `AI_MODELS` (existing gotcha in agent memory).

### 3.4 Readiness split (must ship with dual-mode)

Today (`health.ts`):

```ts
dependencies: aiConfigured ? ok : error  // hard 503
```

Target:

| Probe | Requires |
|-------|----------|
| `/livez` | Process only (already) |
| `/readyz` **core** | startup ready + DB (+ optional background soft) — **not** AI key |
| `/readyz` full or `/ai-ready` | At least one of: Gemini key **or** local host health (`GET LOCAL_AI_BASE_URL/models` or small ping) |

Platform `healthCheckPath` should point at **core** readiness so missing Gemini never marks the plant down.

---

## 4. Dataset schema for distillation flywheel (no GPU required yet)

Align with distillation memo + `lib/ai-evaluation` privacy rules.

### 4.1 Repo vs private store

| In git (public-safe) | Outside repo (private) |
|----------------------|------------------------|
| Manifest: id, brandCode, partition, verified, contentSha256, schemaVersion | Workbook chunk text + assistant JSON |
| Evaluation evidence hashes | Raw teacher outputs |

### 4.2 Manifest row (JSONL index)

```json
{
  "id": "brandA-spec-014-chunk03",
  "partition": "train|dev|holdout",
  "brandCode": "brandA",
  "verified": "deterministic-agreement|human-apply|both",
  "contentSha256": "...",
  "schemaVersion": 40,
  "source": "corpus-snapshot|apply-log",
  "createdAt": "2026-09-28T00:00:00Z"
}
```

### 4.3 Training example (private)

```json
{
  "id": "brandA-spec-014-chunk03",
  "messages": [
    { "role": "system", "content": "<pinned production extract system prompt>" },
    { "role": "user", "content": "<redacted workbook chunk>" },
    { "role": "assistant", "content": "<schema-conformant JSON>" }
  ]
}
```

**Verification rule (anti-poison):** include in `train` only if:

1. Deterministic import path agrees on critical fields, **or**  
2. Human **Apply** accepted the proposal (correction memory / apply log)

Everything else → quarantine, not train.

### 4.4 Splits

- Group by **brandCode** (no brand in two partitions).  
- Near-duplicate scan (input similarity > 0.85) between train and dev/holdout in CI.  
- Holdout never used during iteration; single gate run before merge.

### 4.5 New workspace (suggested)

`lib/distill-dataset/` (or under `lib/ai-evaluation`):

- Manifest schema + validate  
- Brand-group split utility  
- Near-dup check  
- Backfill from apply logs + corpus snapshots (metadata only in CI)

---

## 5. Ordered implementation checklist

### P0 — Ops (unblocks plant)

- [ ] Split readiness: core `/readyz` without AI key requirement  
- [ ] Optional `/ai-ready` or soft `checks.ai`  
- [ ] Confirm platform health path uses core probe  

### P1 — Phase-0 measurement

- [ ] Script: same corpus → Gemini baseline + Ollama candidate  
- [ ] Emit `EvaluationManifest` pairs + comparison  
- [ ] Fill real threshold table from baseline numbers  
- [ ] Decision record in docs / audit portfolio  

### P2 — Adapter dual-mode

- [ ] `AI_PROVIDER` + local OpenAI-compatible transport in `client.ts`  
- [ ] `pickModel` local overrides  
- [ ] Hybrid failover + structured logs  
- [ ] Update agent memory doc for local path sharp edges  

### P3 — Dataset flywheel (parallel, no GPU)

- [ ] Manifest format + private storage convention  
- [ ] Backfill verified examples from Apply + deterministic agreement  
- [ ] Near-dup + brand split CI  

### P4 — Only if Phase-0 fails on quality

- [ ] QLoRA sequence distillation per experiment design doc  
- [ ] Re-run Phase-0 on student  
- [ ] `SPEC_PARSE` / cache version bump policy  

---

## 6. Sharp edges from current Gemini adapter (carry into local)

From `.agents/memory/ai-model-routing-and-streaming.md` + `client.ts`:

| Edge | Local implication |
|------|-------------------|
| Thinking tokens can empty output | Local models: no Gemini thinkingConfig; still enforce max tokens + non-empty check |
| `response_format: json_object` → MIME json | Ollama: `format: "json"` or JSON schema |
| Vision = data URI only | Keep vision on Gemini in hybrid |
| Mocks must export `pickModel` | Unchanged discipline |
| `@google/genai` direct dep of api-server | Local path should not require genai at runtime if `AI_PROVIDER=local` only |

---

## 7. Success criteria (this dig)

You can stop theorizing when:

1. Core readiness is green **without** an AI key.  
2. Phase-0 produces a **side-by-side discrepancy table** on the real corpus.  
3. A documented go/no-go for local primary exists with numbers.  
4. Dataset manifest can grow from every human Apply without putting raw workbooks in git.

---

*Engineering design 2026-09-28 — Phase-0 metrics, dual-mode adapter wiring, and distillation dataset schema grounded in Production Run Calculator code.*
