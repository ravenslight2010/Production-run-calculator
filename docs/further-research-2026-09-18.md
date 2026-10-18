# Further Research — 2026-09-18

**Status:** Research write-up only (no implementation in this document)
**Depends on:** [improvement-research-2026-09-18.md](improvement-research-2026-09-18.md), [sync-system-improvements-plan.md](sync-system-improvements-plan.md), [allergen-tracking-plan.md](allergen-tracking-plan.md), [qc-department-plan.md](qc-department-plan.md), [real-device-floor-controls.md](real-device-floor-controls.md)
**Audience:** Decide architecture and Phase A/D scope before coding.

This document deepens five research tracks that were only sketched in the improvement synthesis. Each section ends with a **decision** or **measurement backlog** so work can start without re-debating the problem.

---

## 1. Sync architecture: full-state patch vs event log

### 1.1 What the app does today

| Mechanism | Behavior |
|-----------|----------|
| Wire format | Complete and partial PUT; complete initial/recovery SSE plus conditional partial peer frames |
| Partial contract | `syncVersion: 1` + `baseSnapshotId`; invalid/stale base returns complete `partialFallback` without applying the sparse write |
| Conflict model | Snapshot-base validation followed by `protectRunValues` / blank-over-populated guards and per-run LWW |
| Offline | Client mutation queue (`syncPushQueue`); drain on reconnect |
| Authority | Server-authoritative live calc / auto-track on the sync stream |
| Known risk | Payload growth; 10 MB parser limit and 512 KB sanitized aggregate cap after the historical 413 (`.agents/memory/sync-body-limit.md`) |

### 1.2 Industry patterns (floor / MES)

1. **Event sync (append-only)** — Clients upload immutable actions (“received 50 of X”, “ended stop”). Server derives stock and status. Strong for inventory truth; weaker for large mutable form documents unless every keystroke is an event.
2. **State + differential sync** — Shadow of last mutual state; send JSON Patch (RFC 6902) or equivalent; full resync on gap. Fits documents that are edited as wholes.
3. **Hybrid** — Events for inventory, QC, and operational claims; LWW/patch for setup forms and run recipe blobs.

Manufacturing offline guidance stresses: write locally first, pre-cache shift data, shift-handoff sync before the next operator takes the tablet, and server-side conflict resolution—not peer merge UIs.

### 1.3 Options for this codebase

| Option | Pros | Cons | Fit with `protectRunValues` |
|--------|------|------|------------------------------|
| **A. Expand current partial sync; optional JSON Patch later** | Builds on the existing under-lock base contract, fallback, and peer deltas | Sparse sections are coarse; client-stamp causality and complete writes still need care | Excellent — reconstruct, then run existing guards |
| **B. Event log for everything** | Natural audit trail; aligns with inventory actuals | Requires redesign of form editing model; large migration | Poor without dual-write period |
| **C. Hybrid** — events for inventory/ops/QC; patch or full-state for run forms | Matches industry “events for mutable stock”; keeps forms simple | Two pipelines to operate and test | Good if event path never bypasses form guards |

### 1.4 Decision (research recommendation)

**Choose Option A for Phase A1:** measure and expand the current partial contract first; prototype JSON Patch only if measured gaps justify another encoding. Defer Option C until inventory truth (Phase B) and QC tables (Phase D) are real append-only domains with their own APIs—not stuffed into day-state.

**Do not** replace day-state LWW with a pure event store in the same effort as delta sync. That is a second project.

**Acceptance criteria for A1 (design-level):**

- Preserve the current complete path and complete initial/recovery frames
- Keep snapshot-base validation under the row lock
- Invalid, stale, or raced base → complete authoritative fallback without sparse apply
- `protectRunValues` / `capMergedResult` run on reconstructed state only
- Measure partial success/fallback and peer-frame ratios
- Convergence and induced stale-base results retained as release evidence; mirror only durable fallback rules in `.agents/memory/`

---

## 2. Payload & performance baseline (measurement research)

### 2.1 What is already known

From `.agents/memory/sync-body-limit.md`:

- Default Express body limit (~100kb) was insufficient in production
- Parser limit raised to **10mb**; sanitized aggregate sync documents are capped at **512 KB**
- Growth driver: **per-run full recipe `FormValues`** embedded in day-state
- Partial PUT and conditional partial peer SSE now reduce eligible wire payloads
- Preferred direction: measure and expand structural reduction, not raise limits

### 2.2 What is *not* known (and blocks success metrics)

| Metric | Why it matters | How to obtain |
|--------|----------------|---------------|
| p50 / p95 / max day-state JSON bytes (production-like days) | Sizes delta-sync ROI | Log `Buffer.byteLength(JSON.stringify(dayState))` on PUT accept (sampled) |
| Bytes per run × run count correlation | Confirms FormValues as driver | Same log + `runs.length` |
| SSE frame size distribution | Wi‑Fi / tablet cost | Log outbound frame size on broadcast |
| Time-to-fresh after tablet wake | Validates wake/recovery work | Client: visibilitychange → first successful sync / SSE frame |
| Offline queue depth at shift handoff | Handoff risk | Client metric or Sync Health panel |

### 2.3 Recommended instrumentation (no product UI required)

**Server (temporary or permanent debug metrics):** Emit bounded sizes and counts only; never log day-state, recipe, request, or SSE payload content.

```text
sync.put.bytes          — body size on accepted PUT
sync.put.runs           — number of runs in payload
sync.sse.frame_bytes    — outbound frame size
sync.put.rejected_413   — should stay 0 after limit raise
```

**Client (dev or manager-only):**

```text
sync.wake_to_fresh_ms
sync.queue_depth
sync.last_success_age_s
```

### 2.4 Provisional success targets (until real numbers exist)

| Target | Rationale |
|--------|-----------|
| p95 partial PUT body **&lt; 500 KB** | Provisional only; compare against the 512 KB sanitized-document cap and track complete fallback separately |
| Wake-to-fresh **&lt; 5 s** on facility Wi‑Fi | Floor usability |
| Queue depth **0** at documented handoff | No silent loss between shifts |

### 2.5 Decision

Treat **measurement as part of Phase A**, not a separate multi-week project. Emit bounded metrics for complete/partial PUTs, fallback rate, and SSE frame mode before expanding the contract; never retain payload content. See [sync-deep-dive-2026-09-19.md](sync-deep-dive-2026-09-19.md).

---

## 3. FSMA / allergen / QC gap analysis (Phase D scope control)

### 3.1 Current app capability (from plans + code references)

| Area | Exists today | Gap |
|------|--------------|-----|
| Run-level allergen field | Single `allergen` on run; normalization + sequence warnings | Not derived from ingredients |
| Ingredient → allergen map | Missing | Core of allergen plan Phase 1 |
| Cleaning verification gate | Sequence *warnings* only | No hard block + signed cleaning log |
| Lot on inventory | Basic lot field | No per-station `run_lots` chain |
| QC department | Thin boundary; photo quality / incidents / downtime scattered | No unified dashboard, weight checks, label/date checks |
| Daily reset vs QC data | Day-state clears; QC must **not** live in day-state | Purge-all must exclude QC audit tables |
| Traceability report | Not built | Lot → run → checks path planned |

### 3.2 External expectation themes (food manufacturing software)

Not a legal opinion—patterns that commercial FSMS/MES products advertise and auditors often ask for:

1. **Allergen master data** on ingredients; **rollup** to product/run
2. **Scheduling / sequencing** awareness (allergen → non-allergen needs cleaning)
3. **Changeover evidence** (who cleaned, when, method, verification)
4. **Lot genealogy** ingredient lot → batch/run → finished goods
5. **Immutable audit** who/what/when; export for inspection
6. **Recall / mock-recall speed** — answer “where did this lot go?” quickly

FSMA 204 applicability and any required Key Data Element automation must be confirmed by the owner with qualified regulatory guidance and customer requirements. Regardless of that determination, **lot-level where-used** and **allergen control evidence** are common expectations for serious buyers and many customers.

### 3.3 Mapping existing plans to “must / later”

**Must for a credible Phase D (minimum viable compliance surface):**

| Item | Source plan | Why |
|------|-------------|-----|
| Ingredient allergen tags + run footprint | Allergen Phase 1 | Stops pure free-text allergen |
| Cleaning verification + gate before non-allergen start | Allergen Phase 2 | Turns warning into evidence |
| `run_lots` per station | QC Phase 1 | Genealogy spine |
| QC role + dashboard (today only) | QC Phase 1 | Operator focus |
| QC tables survive daily reset **and** purge-all | QC critical requirements | Audit integrity |
| Append-only audit fields (who/when/server clock) | QC critical requirements | Accountability |

**Later (Phase D+ or separate):**

| Item | Why defer |
|------|-----------|
| Full shipper label + date-code workflows | High value but depends on lot + dashboard |
| Import QC approval queue | Depends on importer redesign + QC role |
| Weight trend graphs / analytics | Needs volume of weight_checks first |
| Full FSMA 204 KDE export package | Only if product is on FTL or customer demands it |
| Supplier allergen declarations portal | Outside single-facility scope |

### 3.4 Decision

**Phase D MVP = Allergen Phase 1–2 + QC Phase 1 (lots, weight checks, dashboard, purge exclusion, audit columns).**
Do not block MVP on label/date/import-approval/recipe-approval. Keep those as Phase D2 in `qc-department-plan.md`.

**Open product question (needs owner, not more research):** Is the facility on any customer or regulatory path that requires documented mock-recall &lt; 4 hours? If yes, promote lot where-used report into MVP.

---

## 4. Station UX & shift handoff

### 4.1 Current related work

- Home as composition root (`docs/home-architecture.md`)
- Floor Mode + phone layout tests; **physical device trial blocked** without Playwright endpoint (`docs/real-device-floor-controls.md`)
- Line map / live-tab extraction (backlog + Replit-direction work)
- Wake recovery diagnostics in the current merged implementation
- Offline queue exists; **no formal handoff ritual**

### 4.2 Industry station patterns

| Pattern | Implication for this app |
|---------|---------------------------|
| Pre-cache shift data | Before offline periods: today’s runs, active recipe, station checklist |
| Station-specific surface | Freezer vs Packaging vs Sauce see different primary actions |
| Glanceable + large targets | Prefer status + 1–3 actions over full Home density |
| Shift handoff | Outgoing operator drains sync queue; incoming confirms revision / run |
| Evidence at point of work | Photo/lot/weight captured on the station surface, not later at a desk |

### 4.3 Proposed station data contracts (research draft)

Each station surface should declare **online-required** vs **offline-capable** fields:

| Station | Must work offline ≥ 30 min | May degrade |
|---------|----------------------------|-------------|
| **Packaging / Floor** | Case count actions, stop/start, local calc fallback | Manager queue, imports |
| **Warehouse** | Last known coverage snapshot, intake draft queue | Live multi-run coverage |
| **Sauce / Dough** | Batch timers from last projection, local `live-calc` | Server tick freshness badge |
| **QC** | Today’s checklist draft (local); flush when online | History export |
| **Run / Setup** | Form edits queued | Cross-device live presence |

### 4.4 Shift-handoff checklist (product research)

Recommended operator ritual (can be UI-assisted later):

1. Complete or pause in-progress floor action
2. Confirm **sync queue depth = 0** (or wait for drain)
3. Note **last success time** and **canonical revision** (manager-visible)
4. Incoming operator: pull fresh state; confirm active run id
5. Optional: both initials on a handoff log (QC/ops preference)

### 4.5 Decision

- Treat **station contracts + handoff checklist** as Phase C design inputs, not a new sync protocol.
- Unblock **physical device** validation when a real Android Chrome endpoint is available; until then, Chromium phone suite remains necessary but insufficient.
- Productize wake recovery as part of Phase A5 (already in improvement research).

---

## 5. Product positioning (scope fence)

### 5.1 What this app is becoming

A **shift execution system** for a single food production facility:

- Plan and run production days
- Live line timing and auto-track
- Inventory coverage and consumption
- Multi-tablet sync with offline tolerance
- Growing QC / allergen evidence

### 5.2 What it is not (by design)

| Out of scope | Why |
|--------------|-----|
| PLC / SCADA control | Different reliability and safety domain |
| Full ERP (AP/AR, multi-site finance) | Wrong layer |
| Supplier network portal | Multi-enterprise product |
| General-purpose low-code MES builder | Facility-specific speed over configurability |

### 5.3 Integration stance (future research only)

When ERP or WMS appears: **push actuals and lot usage up; pull orders/BOMs down.** Do not duplicate master scheduling inside the run calculator. Document any real integration as a separate ADR later.

---

## 6. Consolidated decisions & next docs

| # | Decision | Follow-on artifact |
|---|----------|-------------------|
| 1 | Phase A1 = measure and expand existing partial PUT/SSE; JSON Patch remains optional; not full event-sourcing | Keep [sync-system-improvements-plan.md](sync-system-improvements-plan.md) |
| 2 | Instrument bounded complete/partial PUT and SSE sizes plus fallback rates; compare sanitized documents against the 512 KB cap | Optional `docs/sync-payload-baseline.md` once numbers exist |
| 3 | Phase D MVP = allergen map + cleaning gate + run_lots + weight checks + QC dashboard + purge exclusion | Trim sequencing in allergen/QC plans if needed |
| 4 | Station contracts + handoff checklist guide Phase C | Optional `docs/station-contracts.md` when UI work starts |
| 5 | Stay a shift execution system; no PLC/ERP scope creep | Reference from README / AGENTS if useful |

---

## 7. Suggested research follow-ups (still open)

These need **facility or production data**, not more web research:

1. Capture one week of anonymized day-state sizes (or enable server metrics).
2. Confirm whether mock-recall SLA is a customer requirement.
3. List physical stations and which tablets sit where (for station contracts).
4. Complete blocked real-device floor-control trial when hardware endpoint exists.

---

## Document maintenance

- Update §2 targets when real percentiles exist.
- Promote §3 “open product question” to a hard requirement or explicit non-goal once the owner answers.
- Keep this document linked from [improvement-research-2026-09-18.md](improvement-research-2026-09-18.md) as the deeper architecture and scope record.
