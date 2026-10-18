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

### 2.1 Blank-run template lockstep (resolved; guardrail remains)

| Location | Current value |
|----------|---------------|
| Client `DEFAULT_VALUES` (`artifacts/run-calculator/src/types.ts`) | `cartonSize: 1` |
| Server `CURRENT_BLANK_RUN_VALUE` (`artifacts/api-server/src/lib/protectRunValues.ts`) | `cartonSize: 1` |

The historical drift is fixed: the client and server blank templates now agree, and server regression coverage mirrors the full client-shaped default. Keep this as a lockstep invariant so any future default field updates both sides in the same change. If drift recurs, exact blank recognition degrades to stamp-based LWW rather than falsely rejecting real edits.

### 2.2 Sync payload growth

`.agents/memory/sync-body-limit.md` documents a production **413** when full day-state outgrew Express’s default body limit. The parser limit is now 10 MB and the sanitized aggregate document is capped at 512 KB. Partial PUT and conditional partial peer SSE are implemented; Phase A must measure and expand those paths rather than treating delta sync as greenfield. Full `FormValues` per run remains the structural growth driver.

### 2.3 Inventory plan-vs-actual gap

Consumption and warehouse planning still lean on planned quantities (`casesNeeded`) more than actuals in several paths. Mix “already made” and prep mixes were advisory relative to stock for a long time; surplus/overproduction accounting remains incomplete relative to floor reality. See backlog items 1, 3, 4 and their dedicated plan docs.

### 2.4 AI surface area vs value

`docs/ai-feature-value-audit-2026-09-05.md` remains the decision standard: keep document extraction and shared AI infrastructure; simplify deterministic features that were dressed as AI; disable/retire high-risk or low-unique-value chat/voice/vision entry points. Do not expand broad assistants until extraction and deterministic ops are fully trusted.

---

## 3. Prioritized improvement program

### Phase A — Stabilize (highest leverage)

#### A1. Partial-sync measurement and expansion (structural priority)

**Status today:** Complete and partial PUTs coexist. Partial writes use `syncVersion: 1` and `baseSnapshotId`, validate the base under lock, inherit omitted sections, and return complete authoritative fallback without applying the sparse write when the base is invalid or stale. Peer SSE can also send a partial frame when it is safe and materially smaller; initial/recovery frames remain complete. See [sync-deep-dive-2026-09-19.md](sync-deep-dive-2026-09-19.md).

**Target**
- Measure complete writes, successful partial writes, partial fallbacks, and partial peer frames
- Expand sparse coverage only for measured hot paths
- Preserve complete initial/recovery responses and `partialFallback` behavior
- Keep `protectRunValues` / `capMergedResult` post-reconstruction
- Treat JSON Patch as optional future encoding, not the starting point
- Prove changes against convergence, large-day, and induced stale-base coverage

**Why first:** Addresses recurring payload-growth risk and floor Wi‑Fi cost using the contract already in production code.

#### A2. Per-device sync health

Surface last successful sync, queue depth, and revision lag per device (reuse patterns from `DataHealthWorkspace` / web-push device tracking). Turns “freezer tablet is 20 minutes behind” into a manager-visible fact.

#### A3. Conflict visibility

When server merge keeps another device’s values, tag response/SSE with a lightweight reconciled signal and show a non-blocking client toast. Merge rules stay server-authoritative; this only closes the trust gap.

#### A4. Blank-template lockstep

- Preserve the current alignment between `CURRENT_BLANK_RUN_VALUE`, legacy recognition, and client `DEFAULT_VALUES`
- Keep the regression test that mirrors normalized client defaults, including machine-time and tunnel defaults
- Any new default field updates **both** sides in the same PR

#### A5. Wake / background recovery (productize)

The current merged wake-recovery implementation is core for always-on tablets, not polish. Productize:

- Visible “recovering sync…” with last-success time
- Bounded diagnostics in Sync Activity
- Shift-handoff checklist: drain offline queue before handoff
- Audit reconnect entry points and strengthen complete-write causality as described in [reconnect-reliability-deep-dive-2026-09-19.md](reconnect-reliability-deep-dive-2026-09-19.md)

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
| §9 Line map | Built and merged | Continue station navigation and operational polish under Phase C |

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
| Sync convergence suite | `artifacts/api-server/src/routes/sync.convergence.integration.test.ts` |
| Further architecture research | `docs/further-research-2026-09-18.md` |
| Capability research pack | `docs/capability-research-pack-2026-09-18.md` |
| Current sync contract | `docs/sync-deep-dive-2026-09-19.md` |
| Reconnect reliability | `docs/reconnect-reliability-deep-dive-2026-09-19.md` |
| Server research | `docs/server-research-2026-09-19.md`, `docs/server-research-deep-dive-2026-09-19.md` |

---

## 8. Document maintenance

- Update this file when a phase exits or a production incident changes priority
- Mirror durable decisions into `.agents/memory/` when they become sharp edges (e.g. delta-sync fallback rules)
- Keep detailed build plans in existing `docs/*-plan.md` files; this file is the **ordering and research synthesis** only
