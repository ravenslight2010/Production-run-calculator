# Import Gold Lab — All-in-One Task

**Date:** 2026-10-21  
**Branch:** `Replit` (primary)  
**Goal:** One implementable track that (1) lets the app **create gold sets** from good imports and (2) runs **local AI** against those cases for comparison — without auto-trusting the model as truth and without breaking Human Apply or soft readiness.

---

## Product rule (non-negotiable)

| Role | Source of truth |
|------|-----------------|
| **Gold `expected`** | Human final state after **successful Apply** (or explicit “confirm gold”) |
| **Local / Gemini** | **Candidates / scores only** — never write `expected` alone |

Local AI is for **scoring and optional assist**, not for inventing gold.

This unblocks the 2026-10-02 local-AI no-go by producing **independently verified** cases and measurable Gemini vs local field accuracy.

---

## Feature name

**`import-gold-lab`** (admin/manager only)

One capability, one settings flag, one table family, one export, one scorer job.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Normal import (unchanged)                                  │
│  deterministic → Gemini and/or local suggest → Review → Apply│
└──────────────────────────┬──────────────────────────────────┘
                           │ Apply success + gold opted-in
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  import_gold_cases                                          │
│  input_json (AI route payload) + expected_json (applied)    │
│  route, importer_type, meta, created_by                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ Admin: “Score gold set”
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Scorer (background, soft)                                  │
│  For each case: deterministic? → Gemini? → LOCAL_AI?        │
│  Field-diff vs expected → import_gold_scores                │
│  Never mutates master data                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Scope (ship as one PR series / one agent task)

### A. Capture (creates the gold set)

1. **Env / flags**
   - `IMPORT_GOLD_CAPTURE=1` (default off in prod until ready)
   - Capability: e.g. `manage-factory-settings` or `manage-import-gold`

2. **UI** (spec / premix / cheese review → after successful Apply)
   - Checkbox: **“Save as AI gold case”** (off by default)
   - Optional manager setting: “Auto-prompt when AI differed from Apply”

3. **API** `POST /api/import-gold/cases`
   - Body: `{ route, importerType, inputJson, expectedJson, meta? }`
   - Server validates size limits, strips secrets, stores row
   - Prefer server reconstructing `inputJson` from the **same** object last sent to `/ai/parse-spec-sheet` or match (import/session id), not trusting arbitrary client blobs

4. **Table** `import_gold_cases`
   - `id` (identity), `scope`, `route`, `importer_type`
   - `input_json`, `expected_json` (jsonb)
   - `input_hash`, `source_label` (optional sanitized)
   - `difficulty` (`easy` | `hard` | `unknown`)
   - `created_by`, `created_at`
   - Soft-delete / `excluded` for bad cases

5. **List + export**
   - `GET /api/import-gold/cases`
   - `GET /api/import-gold/export` → JSONL or zip for offline use
   - Admin only; do not commit real customer workbooks to public git

**Exit criteria A:** One successful Apply with checkbox on → row visible → export contains input + expected.

---

### B. Local AI wiring (score only)

6. **Flags** (do not enable live import routing for all users until scores pass)
   - `IMPORT_GOLD_LOCAL_SCORE=1` (or broader `AI_MODE` later)
   - `LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL`
   - Readiness: local down → scorer marks `local=unavailable`; **core `/readyz` stays ok**

7. **Adapter** (minimal)
   - OpenAI-compatible client to `LOCAL_AI_BASE_URL/v1`
   - **Only** callable from gold scorer until promotion is approved
   - Timeouts, max tokens, JSON-only prompt, Zod parse of model output

8. **Scorer** `POST /api/import-gold/score` (or background job)
   - Input: case ids or “all non-excluded”
   - For each case:
     - Run **local** model on `input_json` → candidate JSON
     - Optional: run **Gemini** on the same input
     - Diff vs `expected_json` per field
   - Write `import_gold_scores` (`case_id`, `provider`, `model`, `field_results`, `exact_match`, `scored_at`, `error`)

9. **UI** minimal admin panel
   - Case count
   - Last score run: Gemini % vs Local % by field
   - “Promote local for route X” = **manual** decision (docs/flag later) — not automatic

**Exit criteria B:** With Ollama (or mock in CI) and ≥5 gold cases, score run writes local vs expected metrics without touching inventory/master Apply.

---

### C. Safety / policy

| Rule | Implementation |
|------|----------------|
| No Apply from scorer | Scorer is read-only vs domain tables |
| No gold from model alone | `expected_json` only from capture path |
| Soft readiness | Local failure ≠ 503 |
| Size limits | Cap JSON bytes per case |
| Auth | Manager capability only |
| Purge | Prefer gold table **survives** factory purge (like QC), or require export-before-purge |
| Live local on import routes | Only after evidence: local field accuracy ≥ agreed bar on gold set |

---

## Schema sketch

```text
import_gold_cases
  id, scope, route, importer_type
  input_json, expected_json, input_hash
  source_label, difficulty, excluded
  created_by, created_at

import_gold_scores
  id, case_id, provider   -- 'gemini' | 'local' | 'deterministic'
  model, exact_match, field_scores jsonb, error, scored_at
```

Use identity primary keys (aligned with serial-to-identity rollout).

---

## Paste-ready agent brief

```text
Branch: Replit only.

Build import-gold-lab (admin/manager only):

1) Migration: import_gold_cases + import_gold_scores (identity PKs, scope).
2) POST /api/import-gold/cases after successful spec/premix/cheese Apply when client sends saveAsGold=true; persist AI route input payload + applied expected JSON; validate size; require capability.
3) Review/Apply UI: checkbox “Save as AI gold case” (default off).
4) GET list + GET export (JSONL) for gold cases; support excluded flag.
5) LOCAL scoring only (not live import routing yet):
   - LOCAL_AI_BASE_URL + LOCAL_AI_MODEL
   - POST /api/import-gold/score runs local OpenAI-compatible completion on each case input, Zod-parses output, diffs to expected, stores import_gold_scores
   - Optional Gemini score in same job for comparison
   - Soft: local down → record error, do not fail /readyz
6) Minimal admin page: case count, last scores (local vs gemini exact-match %).
7) Tests: capture creates row; score with mock local client; unauthorized rejected.
8) Docs: evidence note that gold expected is human Apply only; local used for scoring until promotion bar met.

Do NOT: auto-apply master data from local; enable local on /ai/parse-spec-sheet for all users; embed OpenCode; weaken soft readiness.
```

---

## How this gets gold sets done with local AI

| Step | Who | Result |
|------|-----|--------|
| Import as usual; tick **Save as gold** on good Applies | Humans | Gold set grows |
| Admin runs **Score** with Ollama | Local AI | Numbers vs truth |
| Read field accuracy | Owner | Promote or fix prompts/model |
| Later: hybrid live import | Separate task | Only after bar met |

Local AI is **in the loop** as the evaluator (and later assistant), not as the labeler.

---

## Internal order of work

1. Table + capture API + checkbox (**gold exists without local**)
2. Export
3. Local client + scorer + scores table
4. Admin score UI
5. Short evidence doc under `docs/evidence/`

If Ollama is not available yet, (1)(2) still complete gold-set collection; (3)(4) light up when the local endpoint is up.

---

## Success definition

- [ ] ≥1 real gold row from a human Apply
- [ ] Export usable by a scorer
- [ ] Local score run completes against that row (or mock in CI)
- [ ] Optional Gemini comparison stored
- [ ] Live import path still Gemini/deterministic until explicit promotion
- [ ] `/readyz` unaffected when local is down

---

## Related context

- Local AI adapter decision (2026-10-02): no-go without gold cases and comparison measurements
- Import system plan: review → transactional apply / guarded undo for spec/premix/cheese
- Primary branch: `Replit`; soft readiness preserved
- Do not embed OpenCode as in-app coding agent for this path

---

## One-line summary

**Capture gold from successful human Applies; score with local AI (and optional Gemini); promote live local import routing only after the numbers win.**

---

*Import gold lab all-in-one task — 2026-10-21*
