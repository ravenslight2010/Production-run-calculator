# Replit Agent Brief — SSE Option A + Immediate Work

**Date:** 2026-10-03  
**Primary branch:** `Replit`  
**Owner SSE decision:** **Option A — single always-on API process**

---

## Message to paste into Replit agent

**Primary branch is `Replit`. Execute only the items below; do not expand scope.**

**SSE decision (owner): Option A — single always-on API process.** Document that the API must run as **one** process/instance so process-local SSE stays correct. Do **not** implement shared fanout. Do **not** claim multi-instance live peer updates work. Note this in ops/release docs (e.g. min API instances = 1 / no API horizontal scale for live SSE).

**Ship next (in order):**

1. **Purge-all:** remove `qualityChecksTable` from purge delete lists; update comments; add test that a quality check survives purge-all while normal scoped data is cleared. Future QC tables must stay off purge-all.
2. **SSE Option A:** document the single-process constraint as above; no fanout code.
3. **Web-push:** short sanitized note — root cause fixed vs accepted transient — so current “ok” is intentional.
4. **Do not regress soft readiness** — AI/workers warning must not 503 `/readyz`.

**Full plan (ordering only):** use `FULL-PLAN-production-run-calculator-2026-10-03.md` if attached; ignore LOCAL_AI, QLoRA, full QC schema, and multi-day work until these land.

**Done when:** purge test green, Option A documented, web-push note committed, readiness policy unchanged.

---

## Owner verification after ship

- [ ] `GET /api/readyz` still **200** when only optional checks warn  
- [ ] Sandbox: quality check row **survives** purge-all  
- [ ] Docs state API **single instance** for live SSE  
- [ ] No shared SSE fanout PR without new owner decision  

---

## Related artifacts

| File | Role |
|------|------|
| `FULL-PLAN-production-run-calculator-2026-10-03.md` | Full program plan |
| `consolidated-master-backlog-full-2026-10-03.md` | All backlog ideas |
| `replit-handoff-readiness-sse-qc-2026-10-03.md` | Earlier handoff (superseded on SSE by Option A) |

---

*Brief prepared 2026-10-03 — owner chose SSE Option A.*
