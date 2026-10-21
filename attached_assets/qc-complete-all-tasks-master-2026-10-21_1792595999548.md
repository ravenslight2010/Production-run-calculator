# Master Task: Complete Remaining QC

**Date:** 2026-10-21  
**Branch:** `Replit` (primary)  
**Baseline:** Phase 1 implemented (lots, weights, allergen/cleaning, sign-off, ledger, history/CSV, purge survival).  
**Also include:** **Brix testing** (new; not in the original department plan).

This is **one program, several shippable slices** — not one unbounded PR. Each slice has its own done criteria; the program is complete when all slices below are done or explicitly **won’t-do**’d by the owner.

**Plan reference:** `docs/qc-department-plan.md`  
**Related:** `docs/qc-allergen-phase2-proposal.md`, existing `qcComponentChecks.ts`

---

## Non-negotiable rules (every slice)

1. Append-only **`qc_workflow_events`** (or justified extension); corrections/redactions = new events  
2. Survives **daily reset** and **factory purge**  
3. **Capability-gated**; facility scope from auth  
4. Server timestamps + actor IDs  
5. **Soft / advisory** until a slice explicitly adds hold/release (and owner approves blocking behavior)  
6. No OpenCode / self-modifying agent in QC  
7. Match identity PKs / existing QC API style on Replit  

---

## What Phase 1 already covers (do not rebuild)

| Area | Status |
|------|--------|
| Lots | Append-only lot records |
| Weights | Pre-run / interval checks, targets, tolerance |
| Allergen / cleaning | Reviews, cleaning + verification |
| Sign-off | Per-run; event high-water mark |
| Audit | `qc_workflow_events`; corrections/redactions as new events |
| History | Paginated + manager CSV |
| Survival | Outside day-state; excluded from factory purge |
| UI / API | QC department surfaces + capability-gated routes |

---

## Program map

```text
Slice 0  Brix (measurement parity with weights)     ← quick win
Slice 1  Component checks (lib → API → UI)          ← Phase 2
Slice 2  Label verification                         ← Phase 2
Slice 3  Date-code verification                     ← Phase 2
Slice 4  Import QC approval queue                   ← Phase 3
Slice 5  Recipe change QC approval                  ← Phase 3
Slice 6  Planning calendar (brands/flavors)         ← Phase 3
Slice 7  Trends + analytics + traceability reports  ← Phase 4
Slice 8  Holds / release / line clearance (ops law) ← deferred Phase 1
Slice 9  Allergen Phase 2 (if proposal adopted)     ← optional
```

**“All QC tasks complete”** = Slices **0–7** shipped + Slice **8** either shipped or formally deferred with written owner note. Slice **9** only if the owner adopts the allergen Phase 2 proposal.

---

## Slice 0 — Brix testing

| Item | Spec |
|------|------|
| Event | `brix-check` |
| API | `POST /api/qc/brix-checks`; targets on QC targets API (extension) |
| Payload | `checkType`, `targetBrix`, `actualBrix`, unit `brix`, `tolerance`, server-computed `pass`/`fail`; optional instrument/notes; runId, station, ingredient identity |
| UI | QC **Brix** view beside Weights |
| Default tolerance | e.g. ±0.5 °Bx when unset (confirm with owner) |
| Behavior | Advisory only — do not block run/ship |
| Done | Record + history/CSV + tests; purge-safe |

---

## Slice 1 — Component checks

| Item | Spec |
|------|------|
| Foundation | Existing `artifacts/api-server/src/lib/qcComponentChecks.ts` |
| Event | `component-check` (already in type union) |
| API | Resolve expected components (incl. substitutions); `POST` checklist; server overall pass/fail/not-evaluated |
| UI | Per-run checklist; history |
| Behavior | Advisory only; does not block run/ship |
| Done | E2E: complete checklist, sign-off HWM, correction path |

---

## Slice 2 — Shipper label verification

| Item | Spec |
|------|------|
| Event | `label-check` (add to union) |
| Fields | Expected vs observed label fields (product name, lot, dates as text); pass/fail/not-evaluated |
| UI | Form on run or pack station |
| Done | Ledger + history; advisory |

---

## Slice 3 — Date-code verification

| Item | Spec |
|------|------|
| Event | `date-code-check` |
| Fields | Expected code/rule vs observed; pass/fail |
| UI | Simple form; optional link to label-check |
| Done | Ledger + history; advisory |

---

## Slice 4 — Import QC approval

| Item | Spec |
|------|------|
| Meta | `qc_review_status`: `pending \| verified \| rejected` on import operations |
| UI | QC **Import Review** queue; diff/summary; approve/reject |
| Badge | Unverified imports visible company-wide until verified (per plan) |
| Done | Approve/reject audited; reject offers rollback guidance using existing import undo where available |
| Note | Coordinates with import-gold-lab but does not depend on local AI |

---

## Slice 5 — Recipe QC approval

| Item | Spec |
|------|------|
| Gate | Recipe/master-data changes optional `pending_qc` until QC verifies |
| UI | Queue of pending recipe changes |
| Done | Capability-gated approve/reject; audit events; no silent apply |

---

## Slice 6 — Future planning view

| Item | Spec |
|------|------|
| UI | Calendar/list of upcoming brands/flavors from schedule/planner data |
| Done | Read-only planning aid for QC; no fake scheduling engine |

---

## Slice 7 — Intelligence

| Item | Spec |
|------|------|
| Weight/Brix trends | Charts from ledger aggregates (bounded queries) |
| Analytics | Pass/fail rates by type/station/ingredient |
| Traceability | Lot event → runs → (best-effort) outbound links already stored |
| Done | Manager-only reports; CSV where useful; no unbounded scans |

---

## Slice 8 — Enforcement (only with explicit owner OK)

| Item | Spec |
|------|------|
| Hold / release | Product cannot ship while active hold; release capability + audit |
| Line clearance | Record before next allergen/product; advisory or blocking flag |
| Done | Written policy in plan + tests that hold blocks the chosen action |

Without owner OK on **blocking**, mark Slice 8 **won’t-do** and program can still complete 0–7.

---

## Slice 9 — Allergen Phase 2 (optional)

Implement only what the owner accepts from `docs/qc-allergen-phase2-proposal.md` (extra analytics, stronger gates, etc.).

---

## Suggested sequence and sizing

| Order | Slice | Relative size |
|-------|-------|----------------|
| 1 | **0 Brix** | S |
| 2 | **1 Components** | M (lib exists) |
| 3 | **2 Labels** + **3 Dates** | M |
| 4 | **4 Import approval** | L |
| 5 | **5 Recipe approval** | M–L |
| 6 | **6 Planning** | S–M |
| 7 | **7 Intelligence** | L |
| 8 | **8 Holds** | L + policy |
| 9 | **9 Allergen P2** | TBD |

---

## Deferred from Phase 1 (coverage matrix)

| Deferred item | Slice |
|---------------|--------|
| Component, label, date-code checks | 1–3 |
| Import or recipe approval | 4–5 |
| Trend/analytics | 7 |
| Lot-to-customer traceability | 7 |
| Shipping holds / release | 8 |
| Line clearance | 8 |
| Regulatory/label claims, mock recall, full HACCP pack | Out of scope unless owner adds later |
| Cross-contact analytics | 7 or 9 |
| Finished-lot identification | 7–8 as data allows |

---

## Paste-ready master agent prompt

```text
Branch: Replit only.

Program: Complete remaining QC per docs/qc-department-plan.md plus Brix.

Phase 1 is done. Implement in ORDER; commit after each slice; do not skip to holds until slices 0–3 work.

Slice 0 — Brix: event "brix-check", POST /api/qc/brix-checks, targets, UI next to weights, server pass/fail, history/CSV, tests, advisory only, purge-safe.

Slice 1 — Component checks: wire qcComponentChecks.ts to API + UI + component-check ledger events; server outcomes; sign-off HWM; tests; advisory only.

Slice 2 — Label verification: event label-check, form, ledger, history.

Slice 3 — Date-code verification: event date-code-check, form, ledger, history.

Slice 4 — Import QC approval: qc_review_status pending|verified|rejected; QC queue UI; badges; audit; use existing undo where applicable.

Slice 5 — Recipe QC approval: pending queue, approve/reject, audit.

Slice 6 — Read-only QC planning view for upcoming brands/flavors from existing schedule data.

Slice 7 — Manager trends/analytics/traceability reports from qc_workflow_events (bounded queries).

Slice 8 — ONLY if explicitly confirmed in a follow-up: holds/release and/or line clearance with blocking behavior documented.

Rules: append-only ledger; capability gates; soft readiness; no factory-purge of QC; no OpenCode; no blocking production in slices 0–7.

Update docs/qc-department-plan.md status as each slice completes.
```

---

## Definition of “all QC complete”

- [ ] Brix live (0)  
- [ ] Component + label + date checks live (1–3)  
- [ ] Import + recipe QC queues live (4–5)  
- [ ] Planning view live (6)  
- [ ] Trends/analytics/traceability usable (7)  
- [ ] Holds/line clearance either **shipped (8)** or **written won’t-do**  
- [ ] Plan doc updated; e2e/API tests green for shipped slices  

---

## What this does *not* mean

- One night / one agent session for 0–8 without review  
- Full regulatory HACCP document-control suite  
- Automatic blocking of the line without Slice 8 + owner OK  

---

## One-line summary

**Complete remaining QC = Brix + Phase 2 verification + Phase 3 approval/planning + Phase 4 reports, then optional enforcement — ship slice-by-slice on Replit.**

---

*QC complete-all-tasks master — 2026-10-21*
