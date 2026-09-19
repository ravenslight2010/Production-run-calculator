# Improvement Research — 2026-09-18

**Scope:** Production Run Calculator (web + API; mobile parity paused)  
**Sources:** `docs/idea-backlog.md`, AI feature value audit (2026-09-05), sync improvements plan (research PR), `home-architecture.md`, Replit branch activity (post-PR #62), code review of blank-run guards / inventory math / warehouse snapshot, and industry MES / offline floor-app patterns.

This document consolidates findings into a single prioritized improvement map. It does **not** replace detailed plans under `docs/*-plan.md`; it orders work and records decisions so backlog items stop conflicting with reality.

---

## 1. Strengths to preserve

Do not redesign these without a strong reason:

| Strength | Why it matters |
|----------|----------------|
| Server-authoritative live calc + auto-track | Multi-tablet consistency on the line |
| LWW + blank-over-populated guards (`protectRunValues`) | Prevents “I entered it and it vanished” |
| Shared pure math in `lib/*` | Web/mobile parity path when mobile resumes |
| Institutional memory (`.agents/memory`) | Sharp-edge knowledge for a complex ops system |
| Capability-based auth + daily-reset session fence | Correct model for shared facility tablets |
| Deterministic import + corpus harness | Spec import is the highest-value AI workflow |
| Home as composition root (`docs/home-architecture.md`) | Clear ownership of day-state, live clock, stations |

Industry parallel: mature MES / connected-worker apps treat the server as source of truth and tablets as durable clients with offline queues—not peer-to-peer state machines. This codebase is already closer to that model than most custom floor apps.

---

## 2. Known defects and residual risk (as of research date)

### 2.1 Blank-run template drift (`cartonSize`)

| Location | Value |
|----------|--------|
| Client `DEFAULT_VALUES` (`artifacts/run-calculator/src/types.ts`) | `cartonSize: 1` |
| Server `CURRENT_BLANK_RUN_VALUE` (`artifacts/api-server/src/lib/protectRunValues.ts`) | **missing** on `main` at research time |

Exact deep-equality blank recognition fails for client-shaped blanks that include `cartonSize: 1`. Protection **degrades** to stamp-based LWW; it does **not** false-reject real edits (by design). Fix path existed on PR/branch work (`fix/blank-guard-cartonsize` / related post-merge regression work). Keep a lockstep test so future default fields cannot drift silently.

### 2.2 Sync payload growth

`.agents/memory/sync-body-limit.md` documents a production **413** when full day-state outgrew Express’s default body limit. Raising the limit was a stopgap; structural fix is delta sync (see §3.1). Full `FormValues` per run continues to grow as fields are added.

### 2.3 Inventory plan-vs-actual gap

Consumption and warehouse planning still lean on planned quantities (`casesNeeded`) more than actuals in several paths. Mix “already made” and prep mixes were advisory relative to stock for a long time; surplus/overproduction accounting remains incomplete relative to floor reality. See backlog items 1, 3, 4 and their dedicated plan docs.

### 2.4 AI surface area vs value

`docs/ai-feature-value-audit-2026-09-05.md` remains the decision standard: keep document extraction and shared AI infrastructure; simplify deterministic features that were dressed as AI; disable/retire high-risk or low-unique-value chat/voice/vision entry points. Do not expand broad assistants until extraction and deterministic ops are fully trusted.

---

## 3. Prioritized improvement program

### Phase A — Stabilize (highest leverage)

#### A1. Delta sync (structural priority)

**Status today:** Full-state push/store; offline queue and LWW already exist; optimistic locking via `canonicalRevision` already exists. Backlog §16 under-credited the system—update status accordingly.

**Target**
- Client and server keep a shadow of last mutually acknowledged day-state keyed by `canonicalRevision`
- Wire format: JSON Patch (RFC 6902) or equivalent
- Feature-flagged; **full-state fallback** on missing shadow, gap, or patch apply failure
- `protectRunValues` / `capMergedResult` stay post-reconstruction (unchanged semantics)
- Prove against `sync.convergence.integration.test.ts` + induced patch-failure soak

**Why first:** Addresses recurring payload-growth risk and floor Wi‑Fi cost without endless body-limit bumps.

#### A2. Per-device sync health

Surface last successful sync, queue depth, and revision lag per device (reuse patterns from `DataHealthWorkspace` / web-push device tracking). Turns “freezer tablet is 20 minutes behind” into a manager-visible fact.

#### A3. Conflict visibility

When server merge keeps another device’s values, tag response/SSE with a lightweight reconciled signal and show a non-blocking client toast. Merge rules stay server-authoritative; this only closes the trust gap.

#### A4. Blank-template lockstep

- Align `CURRENT_BLANK_RUN_VALUE` (and legacy recognition) with client `DEFAULT_VALUES`
- Add regression test: server blank template must deep-equal normalized client defaults (including machine-time / tunnel defaults normalization)
- Any new default field updates **both** sides in the same PR

#### A5. Wake / background recovery (productize)

Recent Replit-branch work (wake recovery diagnostics, Android PWA resume, faster visible recovery) is core for always-on tablets, not polish. Productize:

- Visible “recovering sync…” with last-success time
- Bounded diagnostics in Sync Activity
- Shift-handoff checklist: drain offline queue before handoff

### Phase B — Inventory truth

Order matches existing plans (`inventory-autodeduction-plan`, mix/overproduction plans):

1. Consume / adjust on **actual cases** and overproduction, not only planned `casesNeeded`
2. Mix-made deduction + mix surplus ledger (prep is real stock movement)
3. Freezer-pull double-count fix
4. Full packaging suite (labels, sheets, pallets, tape/glue/ink) with QC lot linkage where applicable
5. Later: waste/spoilage, mid-run stoppage waste, returns

Without B, warehouse alerts and multi-day prep optimize the wrong numbers.

### Phase C — Floor UX

Industry MES guidance favors **station-specific, glanceable, glove-friendly** surfaces over denser admin screens.

1. Continue live-tab / station extraction; enforce Home ownership rules (`docs/home-architecture.md`)
2. Line map as situational awareness (backlog §9); station-to-tab navigation
3. Unified **today + multi-day prep checklist** (backlog §8): conflicts, pull/make/stage, one checklist instead of four mental tabs
4. Large targets, high contrast, minimal typing on station surfaces

### Phase D — QC and allergen

1. **QC Phase 1** (backlog §2): QC role, per-run lot tracking, weight checks, QC dashboard. QC data survives daily reset and purge-all.
2. **Allergen** (backlog §5): ingredient→allergen map, auto run footprint, cleaning verification gate, daily report.

Treat as compliance systems with immutable audit trails—not chat features.

### Phase E — AI portfolio cleanup

Follow the 2026-09-05 audit:

| Keep | Simplify | Disable / retire |
|------|----------|------------------|
| Spec/workbook extraction + review/apply | Deterministic recap, anomalies, schedule order (drop narration) | Broad day Q&A, shift-optimize chat, mix/recipe chat as primary UX |
| Correction memory, sanitizers, cost controls | One “resolve unresolved setup” matcher | Voice commands that mutate state without strong confirm |
| Shared model routing / retries | Proactive alerts → deterministic triggers only | Forecast-from-history-only; vision as release authority |

**Rule:** AI reduces transcription and matching labor. It does not narrate numbers the app already computes and does not look like QC/release authority.

### Phase F — Reporting and analytics

After inventory truth and stable sync:

- Automated end-of-day report + PDF/CSV export
- Multi-day trends, waste cost, comparison views
- Downtime cost, recurring-issue detection, correlations (backlog §6–7)

---

## 4. Explicit non-priorities (for now)

- Another broad AI assistant surface
- Selective sync **before** delta sync is measured in production
- Full mobile parity until web station UX + sync + inventory truth are stable (per README user preference)
- Free-form per-operator low-code UIs; prefer **role/station templates** consistent with shared facility tablets
- Raising sync body limits again without a delta path

---

## 5. Backlog status corrections

| Backlog item | Prior status in backlog | Corrected assessment |
|--------------|-------------------------|----------------------|
| §13 Server-side migration | Done (slices 1–7) | Keep **Done** |
| §16 Sync | Ideas only; lists optimistic locking & offline queue as ideas | **Partially built.** LWW, `canonicalRevision`, offline queue, SSE live push, protect guards exist. Still missing: delta sync, device health, conflict visibility, selective sync |
| §11 AI improvements | Ideas expand QC vision, voice, NL queries | **Contradicts AI audit.** Prefer audit portfolio: narrow extraction; do not expand high-risk surfaces by default |
| §1 Mix plan inventory | Marked Done in places | Verify against code: surplus/ledger may have shipped; keep residual gaps explicit in inventory plans |
| §9 Line map | Built, pending merge | Confirm branch/PR state on merge; Replit branch continued related live-station extraction |

---

## 6. Suggested 90-day execution order

| Window | Focus | Exit criteria |
|--------|--------|----------------|
| Days 1–30 | A1–A5 (delta flag, blank lockstep, sync health MVP, wake productization) | Feature-flagged delta path green on convergence tests; blank regression test; managers can see device lag |
| Days 31–60 | B1–B3 (actuals, mix-made, freezer double-count) | Inventory ledger matches floor for completed runs and mix prep in staging |
| Days 61–90 | C + D Phase 1 + E cleanup | Station surfaces stable; QC Phase 1 usable; AI disable/simplify items closed or scheduled |

Adjust dates to facility capacity; do not reorder A before B/C unless a production incident forces it.

---

## 7. Key code and doc references

| Area | Path |
|------|------|
| Sync API | `artifacts/api-server/src/routes/sync.ts` |
| Blank / merge guard | `artifacts/api-server/src/lib/protectRunValues.ts` |
| Client defaults | `artifacts/run-calculator/src/types.ts` |
| Client sync | `artifacts/run-calculator/src/contexts/SyncContext.tsx`, `syncPushQueue.ts` |
| Inventory math | `lib/inventory-math/src/index.ts` |
| Warehouse snapshot | `artifacts/api-server/src/routes/warehouseSnapshot.ts`, `lib/warehouseSnapshot` |
| Home ownership | `docs/home-architecture.md` |
| Idea backlog | `docs/idea-backlog.md` |
| AI portfolio | `docs/ai-feature-value-audit-2026-09-05.md` |
| Body-limit incident | `.agents/memory/sync-body-limit.md` |
| Sync soak | `.agents/memory/sync-convergence-soak.md` |

---

## 8. Document maintenance

- Update this file when a phase exits or a production incident changes priority
- Mirror durable decisions into `.agents/memory/` when they become sharp edges (e.g. delta-sync fallback rules)
- Keep detailed build plans in existing `docs/*-plan.md` files; this file is the **ordering and research synthesis** only
