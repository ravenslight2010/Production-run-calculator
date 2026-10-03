# Tailoring AI to Production Run Calculator

**Date:** 2026-09-28  
**Purpose:** Map general “how to build AI” research onto **this app’s** documented plans, idea backlog, improvement phases, and hard constraints—so AI work does not fight Phase A–D priorities or the AI value audit.

**Related docs:**  
`how-to-build-ai-research-2026-09-28.md` · `improvement-research-2026-09-18.md` · `idea-backlog.md` · `capability-research-pack-2026-09-18.md` · `server-research-deep-dive-2026-09-19.md` · `uptime-reliability-code-check-2026-09-20.md` · (repo) `docs/ai-feature-value-audit-2026-09-05.md`

---

## 1. Non-negotiable product constraints (AI must obey)

These come from existing deep dives and improvement research. Any AI feature that violates them is out of scope.

| Constraint | Source | Implication for AI |
|------------|--------|-------------------|
| **Server-authoritative live calc + LWW + `protectRunValues`** | Improvement research §1; sync deep dives | AI never writes day-state as a silent full LWW push. Prefer **propose → human confirm → intentional apply** (same family as import apply / claim machine). |
| **Value protection / blank guards** | `protectRunValues`, blank-template lockstep | Extraction output must not look like “blank” templates that wipe populated runs. Validate against client `DEFAULT_VALUES` / server blank templates. |
| **Operational intents + audit** | Claim state machine, audit protection | Mutating AI paths should land as **reviewable apply** with who/when/what, not free-form chat edits. |
| **Readiness ≠ AI** | Uptime brief, server deep dive | Missing OpenAI/Gemini key must **not** take floor sync offline. Split **core ready** vs **AI ready**; keep circuit breaker **out of** `upsertProtected`. |
| **AI portfolio rule** | Improvement Phase E; AI value audit | AI reduces **transcription and matching labor**. It does **not** narrate numbers the app already computes and is **not** QC/release authority. |
| **Phase order** | Idea backlog recommended build order | Do **not** expand broad AI before stabilize (A), inventory truth (B), floor UX (C), QC Phase 1 (D). |

**Explicit non-priorities (already documented):**

- Another broad AI assistant surface  
- Voice commands that mutate state without strong confirm  
- Vision as release authority  
- Forecast-from-history-only  
- Expanding QC chat / mix-recipe chat as primary UX  

---

## 2. What the app already has (AI-relevant)

| Capability | Role | Portfolio stance |
|------------|------|------------------|
| Spec / workbook **document extraction** + review/apply | Highest-value AI workflow | **Keep** — deterministic import + corpus harness is a strength |
| Shared model routing / retries / sanitizers / cost controls | Infrastructure | **Keep** |
| Correction memory | Improves extraction over time | **Keep** |
| AI provider as **hard readiness** dependency | Ops risk | **Fix** — soft-dep / AI-ready probe (uptime + server research) |
| Circuit breaker + retry (`lib/resilience.ts`) | Resilience | **Keep** — never on sync write path |
| Broad chat / day Q&A / shift-optimize / voice / vision | Surfaces | **Simplify or retire** per Phase E table |

Industry parallel (capability pack): this is a **shift execution** system for one frozen-pizza line—not APS, not full WMS, not PLC. AI should assist **keying, matching, and triage**, not replace MES math or QC sign-off.

---

## 3. Map general AI patterns → this product

| General pattern (2026 research) | Fit for this app | How to tailor |
|---------------------------------|------------------|---------------|
| **LLM app** (prompt + structured output) | Excellent for extraction, field matching, short classify | Primary pattern for Phase E “keep” work |
| **RAG** over private docs | Useful **later** for SOPs / allergen / packaging rules | Read-only first; never auto-apply to day-state |
| **Agent** (tools + loop) | Only if ≤ few tools and confirm gates | Tools = extract, match profile, propose import, **not** `upsertProtected` |
| **Fine-tune** | Low priority | Extraction corpus + correction memory beats fine-tune for now |
| **Eval set before features** | Mandatory | Factory file corpus + golden apply outcomes already implied by “deterministic import + corpus harness” — expand, don’t abandon |

---

## 4. Phase-aligned AI plan (respects documented order)

### Phase A — Stabilize (AI only as *ops hygiene*)

AI product features are **not** the goal here. Allowed AI-related work:

1. **Readiness split (P0 ops)**  
   - `livez` / core `readyz`: process + DB (+ optional audit soft)  
   - `ai-ready` or soft dependency: provider key + circuit health  
   - Stops “missing Gemini key = plant down” (documented uptime root cause)

2. **Keep AI off the critical path**  
   - Sync, live-calc, claims, protect paths never await LLM  
   - Circuit breaker stays in AI client only

No new chat surfaces in Phase A.

### Phase B — Inventory truth (AI = extraction quality only)

Inventory gaps are **deterministic** (actual cases, mix-made deduction, packaging list, freezer double-count). Do **not** solve them with an agent.

Allowed:

- Improve **spec/profile extraction** accuracy so setup fields that feed inventory math are correct  
- Optional: classify messy intake notes → structured lot fields **with human confirm**

Disallowed:

- AI that “guesses” consumption or invents surplus dispositions

### Phase C — Floor UX (AI = optional assist, not primary UI)

Station-first, glove-friendly, glanceable. Chat is the wrong primary surface.

Allowed later (after C stabilizes):

- **Resolve unresolved setup** matcher (one focused tool)—already in Phase E “simplify” column  
- Short “what’s missing on this run” checklist generated from **existing** calc/coverage, not free-form narration

### Phase D — QC / allergen (AI = labor reduction only)

QC is compliance: immutable audit, survives purge, not chat authority.

| Allowed | Disallowed |
|---------|------------|
| OCR/extract from label photos → **proposed** lot/weight fields for QC entry | Vision auto-pass / release |
| Suggest allergen footprint from ingredient list (rules + optional LLM explain) | AI as cleaning verification gate |
| Import approval queue: AI pre-fills review form | AI auto-approves import |

### Phase E — AI portfolio cleanup (primary AI engineering phase)

Follow the locked table from improvement research:

| Keep | Simplify | Disable / retire |
|------|----------|------------------|
| Spec/workbook extraction + review/apply | Deterministic recap, anomalies, schedule order (**drop narration**) | Broad day Q&A, shift-optimize chat, mix/recipe chat as primary UX |
| Correction memory, sanitizers, cost controls | One “resolve unresolved setup” matcher | Voice mutate without strong confirm |
| Shared model routing / retries | Proactive alerts → **deterministic triggers only** | Forecast-from-history-only; vision as release authority |

**Build order inside E:**

1. Harden extraction: eval corpus, correction memory feedback loop, cost caps  
2. Review/apply UX: never write without explicit apply (align with import apply / claim patterns)  
3. Collapse low-value “AI-looking” deterministic features to plain UI  
4. Retire or feature-flag high-risk surfaces  
5. Only then consider **one** new narrow tool (e.g. setup matcher or read-only NL over **exported** day summary)

### Phase F — Reporting (post-truth)

After inventory + stable sync:

- End-of-day report: mostly **deterministic** aggregation; LLM optional for executive summary **with numbers sourced from calc**, not invented  
- Trend / downtime: rules + SQL first; LLM for narrative optional and secondary  

---

## 5. Concrete feature candidates (ranked for *this* app)

Scored against: value audit, phase order, protect/sync safety, floor reality.

| Rank | Candidate | Pattern | Phase | Writes state? | Notes |
|------|-----------|---------|-------|---------------|-------|
| **1** | Spec/workbook extraction + review/apply | Structured LLM + schema | E (keep) | Only on **Apply** | Already highest-value; invest evals here |
| **2** | Readiness: AI soft-dep | Ops, not LLM | A | No | Unblocks plant when key missing |
| **3** | Correction memory loop | Infra | E | Metadata only | Improves (1) without new UI surface |
| **4** | Resolve unresolved setup (single matcher) | Classify + propose | E simplify | Propose only | One tool, not a chat product |
| **5** | QC label/lot field proposals from photo | Vision → form fields | D+ later | Propose only | Never release authority |
| **6** | Read-only NL over day summary / SOPs | RAG or grounded Q&A | After E | No writes | Only if (1)–(4) trusted |
| **7** | Packaging/sauce plan **proposals** | Agent-lite + calculators | After B+E | Propose only | Must use `lib/*` math, not re-derive |
| **X** | Broad day assistant / shift optimizer chat | Agent | **Non-priority** | Risky | Explicit non-priority |
| **X** | Voice mutate day-state | Agent | **Non-priority** | High risk | Audit + confirm bar too high for now |

---

## 6. Architecture rules when adding AI to this monorepo

```text
[Client / station UI]
        │  propose only (drafts, review cards)
        ▼
[API: AI routes] ── resilience (retry, circuit) ── provider
        │
        │  never inside upsertProtected / claim commit
        ▼
[Apply endpoints] ── same guards as import apply / intents
        │  audit log, capability checks, protectRunValues semantics
        ▼
[Day-state / inventory / QC tables]
```

1. **Separation:** AI routes ≠ sync routes.  
2. **Apply gate:** Structured proposal JSON → validated (Zod) → existing apply/import path.  
3. **Idempotency:** Re-apply of same proposal = duplicate/stale, not double write (mirror claim machine).  
4. **Cost:** Per-request and daily caps; log token use.  
5. **Evals:** Golden factory files in CI; fail build on extraction regression.  
6. **Readiness:** Core app up without provider key.

---

## 7. Eval strategy tailored to the facility

| Eval type | Content | When |
|-----------|---------|------|
| **Extraction golden set** | Real/redacted workbooks & specs → expected `FormValues` / profile fields | Every PR touching AI import |
| **Apply safety** | Proposal must not blank protected fields; cartonSize etc. lockstep | Sync + AI integration tests |
| **Refusal** | Garbage PDF → clear failure, no partial poison of day-state | Extraction path |
| **Cost smoke** | Max tokens / latency budget per import | Staging |
| **No-sync-coupling** | Kill AI provider mid-test → sync still converges | Release gates |

Do **not** measure success by “chat helpfulness.” Measure **fields correctly filled / minutes saved / apply error rate**.

---

## 8. Alignment with idea backlog items

| Backlog theme | AI role |
|---------------|---------|
| Mix plan / inventory truth (§1, §3, §4) | None until deterministic; extraction only helps upstream setup accuracy |
| QC department (§2) | Propose fields; QC human owns pass/fail |
| Line map / station UX (§8–9 style) | No chat chrome on station surfaces |
| Reporting / downtime (§6–7) | Deterministic first; optional narrative later |
| AI improvements (§11 historical) | **Superseded by Phase E audit** — do not treat old “expand voice/vision/NL” as current plan |
| Sync (§16) | AI unrelated except readiness soft-dep |

---

## 9. Recommended near-term actions (ordered)

1. **Document + implement AI soft readiness** (Phase A ops)—stops false downtime.  
2. **Freeze portfolio:** feature-flag or hide non-audit surfaces (Phase E disable column).  
3. **Double down on extraction:** expand golden corpus; correction memory; review/apply only path to day-state.  
4. **One matcher tool** (unresolved setup) after extraction quality is measured.  
5. **Defer** RAG day Q&A, planning agents, and vision release until B–D foundations and E cleanup are done.

---

## 10. One-page decision standard

When someone proposes a new AI idea, require answers:

1. Which **Phase E column** is it (keep / simplify / retire)?  
2. Does it **write** production state? If yes, what is the **human apply** step?  
3. Can the plant run if the **provider is down**?  
4. What is the **eval set** (files + expected fields)?  
5. Does it **narrate** numbers `lib/live-calc` already computes? If yes → reject or simplify to deterministic UI.  
6. Could it be mistaken for **QC/release authority**? If yes → redesign or reject.

If any answer is weak, do not build it yet.

---

*Research synthesis 2026-09-28: general AI build guidance tailored to Production Run Calculator documented plans, phases A–F, AI value audit, and sync/protect/readiness constraints.*
