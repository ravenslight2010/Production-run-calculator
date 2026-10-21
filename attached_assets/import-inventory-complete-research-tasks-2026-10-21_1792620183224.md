# Import Product + Inventory — Research Synthesis & Completion Tasks

**Date:** 2026-10-21  
**Branch:** `Replit`  
**Sources:** `docs/import-system-plan.md` (2026-10-08), `docs/inventory-autodeduction-plan.md`, `docs/inventory-gap-analysis.md`, prior research (deterministic-first, gold lab, server intents, LWW)

Two parallel product tracks. Ship **slice-by-slice**; do not merge with QC holds or live local-AI routing until their own gates pass.

---

## A. Import product

### Research takeaways

1. **Deterministic-first** beats “more model” for Excel structure; AI only on unresolved match/extract.
2. **Human Apply** + transactional apply/undo is the safety core (already largely built for spec/premix/cheese).
3. **Preview before apply** (diff + stock impact) reduces bad lands more than smarter AI alone.
4. **Gold set** (separate lab) is required before local AI can beat or replace Gemini on imports.
5. **QC approval** of imports is a QC-owned gate; import system only exposes status + data.

### Already in good shape (do not rebuild)

- AI-assisted matching + fuzzy fallback + aliases  
- Review stages, history, snapshots, source vs landed  
- Transactional apply + guarded undo (spec/premix/cheese)  
- Stock impact preview for **selected run** (read-only)  
- Spec multi-file parsing (partial batch)  
- Cell provenance / citations (recent work)  

### Remaining work → import slices

| Slice | Item | Plan status | Spec (research-aligned) |
|-------|------|-------------|-------------------------|
| **I0** | Structured before/after **preview diff** | Partial / new | All supported importers: field-level old→new before Apply |
| **I1** | Shared **validation preflight** | Partial | One pre-check: required columns, types, hard fail before AI/review |
| **I2** | **Template download** | Open | Canonical templates per importer type you will maintain |
| **I3** | **Cross-import health** view | Partial | Single UI: broken name-links, orphan mixes, unmatched aliases |
| **I4** | **Re-import version diff** | Open | Same `sourceKey`: what changed vs last successful apply |
| **I5** | **Batch apply** beyond multi-file parse | Partial | Mixed-type batch only if review still per-entity + one Apply confirmation |
| **I6** | **QC review status** hooks | QC Phase 3/4 | `pending\|verified\|rejected`; no stock mutation on status alone |
| **I7** | **Import gold lab** | Designed | Capture gold from Apply; score local/Gemini (see gold-lab brief) |
| **I8** | Import scheduling | Deferred | Skip unless recurring file source exists |

### Import build order (recommended)

```text
I0 Preview diff (all types you support)
I1 Shared preflight
I3 Cross-import health
I4 Re-import version diff
I2 Templates (when formats stable)
I7 Gold lab (AI quality track)
I6 QC status hooks (with QC slice 4)
I5 Batch apply (last — highest risk)
I8 Scheduling only if needed
```

### Import non-negotiables

- Apply remains human-confirmed  
- Undo only while rows match snapshot (existing rule)  
- Stock preview never mutates inventory  
- AI suggestions never skip review  
- Soft degrade if AI down  

### Import “done” definition

- [ ] Preview diff on apply path for supported types  
- [ ] Shared preflight fails bad files early  
- [ ] Health view covers main link/alias failures  
- [ ] Re-import shows prior-vs-current for known sources  
- [ ] Gold capture/score available (I7) when AI track is active  
- [ ] QC status ready when QC import queue ships  

---

## B. Inventory

### Research takeaways

1. **Server-authoritative physical events** + idempotent intents beat client-side stock guesses.  
2. Consume **actual cases**, not plan, when packaging completes.  
3. **Freezer / mix / surplus** must not double-count (ledger + operation id).  
4. Packaging is a **checklist of materials** (carton, slip, grip, label, pallet, …), each with a formula path.  
5. Waste, returns, damage are **explicit events**, not silent drift.  
6. Import→inventory is **projection only** until a run consumes.

### Plan status (2026-10-08 reconciliation)

| Area | Status |
|------|--------|
| Core physical-event accounting | Implemented |
| Mix day-start path | Built |
| Freezer surplus / parity tests | Core path + tests |
| Finished-case damage/return/correction | Implemented path |
| Actual-case consumption | Source exists; verification partial |
| Full packaging E1–E7 | Formula paths exist; tests partial |
| Daily reset inventory behavior | Partial |

### Historical gaps (gap analysis) → still verify

| Gap | Theme | Action |
|-----|--------|--------|
| Overproduction ingredients | Actual vs planned | Verify actual-case path; add tests if thin |
| Mix / prep mix | Day-start / already-made | Verify no double deduct |
| Freezer pull | Double-count | Keep parity tests green |
| Waste & spoilage | Explicit event | Ensure UI + ledger event |
| Stoppages mid-run | Partial consume | Policy + event if missing |
| Returns | Explicit event | Align with finished-case corrections |
| Packaging non-carton | E1–E7 | Complete formulas + tests per item |
| Conversion factors | Units | Guard missing factors |

### Inventory slices

| Slice | Item | Spec |
|-------|------|------|
| **V0** | **Verification pack** | Tests/evidence: actual cases, mix day-start, freezer parity, damage/return — document pass |
| **V1** | **Waste / spoilage event** | Explicit capability-gated adjust; idempotent operation id |
| **V2** | **Mid-run stoppage** | Partial consumption rules + event (owner formula) |
| **V3** | **Packaging completion** | E1–E7: each material has formula, consume on event, tests |
| **V4** | **Returns path UX** | Operator-clear return/damage/correction entry |
| **V5** | **Conversion guards** | Fail closed or warn when factor missing |
| **V6** | **Reset/day boundary** | Yesterday commitments don’t ghost-deduct today |
| **V7** | **Import demand multi-profile** | Optional: stock preview for all products in workbook (plan note: only selected run today) |

### Inventory build order

```text
V0 Verification pack (prove what’s already built)
V3 Packaging items with missing tests (highest floor impact)
V1 Waste/spoilage if used on floor
V4 Returns UX polish
V2 Stoppage policy if real
V5 Conversion guards
V6 Day boundary checks
V7 Multi-profile import preview (nice-to-have)
```

### Inventory non-negotiables

- No parallel client stock writers  
- Idempotent `operationId` / intent ledger  
- Prefer server tick / claim paths already used for auto-track  
- Soft readiness unchanged  

### Inventory “done” definition

- [ ] V0 evidence written (what’s proven vs assumed)  
- [ ] Packaging materials you actually use all have consume + test  
- [ ] Waste/return/damage usable on floor  
- [ ] No known double-count on freezer/mix in tests  
- [ ] Actual cases drive finished consumption where product requires it  

---

## C. Combined program order (with QC + AI research)

```text
Active now     → QC early slices (Brix / components / …)
Next product   → Import I0–I4 (diff, preflight, health, re-import diff)
Parallel AI    → I7 gold lab (when ready for Apply checkbox)
Inventory      → V0 then V3 (verify, then packaging completeness)
Join           → I6 + QC import approval together
Later          → I5 batch, V2/V7, local AI promotion after gold scores
```

Avoid: three large agents rewriting sync + import + inventory at once.

---

## D. Paste-ready agent prompts

### Import completion (product, not AI)

```text
Branch: Replit only.

Complete remaining import product work per docs/import-system-plan.md.

Order:
1) Structured before/after preview diff on supported importer apply paths.
2) Shared validation preflight (required columns/types) before heavy parse/AI.
3) Cross-import health view (name-links, orphans, alias gaps).
4) Re-import version diff by sourceKey vs last successful apply.
5) Template download only for importer types with a maintained canonical format.

Rules: human Apply; existing undo contracts; stock preview read-only; no live local AI routing; no OpenCode.
Update import-system-plan.md status as items complete. Tests for diff/preflight/health.
```

### Inventory completion

```text
Branch: Replit only.

Complete inventory remaining work per docs/inventory-autodeduction-plan.md and gap analysis.

Order:
1) Verification pack: tests/evidence for actual-case consumption, mix day-start, freezer parity, finished-case damage/return/correction.
2) Packaging E1–E7: ensure each material used in production has formula path + consume event + tests (skip unused materials with a written won’t-do).
3) Waste/spoilage explicit event if not complete.
4) Conversion-factor guards; day-boundary checks.

Rules: server-authoritative idempotent events; no client stock authority; no double-count; soft readiness.
Document proof in docs/evidence or plan status. Do not invent hold/release.
```

### Import gold lab (AI track — separate)

Use existing brief: `replit-agent-prompt-import-gold-lab-2026-10-21.md`.

---

## E. Research vs “just code”

| Question | Answer from research |
|----------|----------------------|
| Why imports still hurt | Weak preflight/diff/re-import clarity + AI quality; not only missing undo |
| Why stock drifts | Event coverage gaps + double paths; verify built paths then close packaging/waste |
| AI first or product first? | **Product preflight/diff/health first**; gold lab in parallel; local model last |
| Import↔inventory | Preview only until run consumes — already directionally correct |

---

## One-line summary

**Import:** finish diff, preflight, health, re-import diff, then gold lab + QC status.  
**Inventory:** verify core events, complete packaging/waste you use, keep server intents.  
**Sequence:** QC slice in flight → import product slices → inventory V0/V3 → gold lab when AI is the bottleneck.

---

*Import + inventory research & completion tasks — 2026-10-21*
