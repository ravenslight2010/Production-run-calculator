# Research & Plan Inventory (as of main @ 869817cc, 2026-10)

## research/ — synthesis documents

| File | Topic |
|---|---|
| sync-reliability-operations-deep-dive-2026-09-19.md | Sync architecture, stale-write path, readiness defect, pool sizing |
| sse-deployment-research.md | `/sync/events` contract, heartbeats, Replit Autoscale vs Reserved VM, live-probe protocol |
| reconnect-causality-research.md | Causal fencing via baseSnapshotId, LWW lost-update analysis |
| db-pool-topology-research.md | Pool topology and sizing vs instance count |
| ai-readiness-policy-research.md | Circuit breakers, SLOs, graceful degradation |
| sync-payload-research.md | Payload formats, RFC 6902 / 7396 |
| sse-scale-verification-2026-09-20.md | SSE scale verification follow-up |
| additional-domain-research-synthesis-2026-09-19.md | Cross-domain synthesis |
| deep-dive-research-continuation-2026-09-19.md | Continuation notes |
| gap-readiness-dependency.md, gap-replit-sse-contract.md | Known evidence gaps |
| notes.md, sources.json, sources/ | Working notes + 20+ cited source snippets |

## docs/superpowers/plans/ (13)

schema-safe-application-rollback-rehearsal (09-03); auto-track-engine (09-06); server-live-calc-stream + slices 2–6 (09-13/14); server-warehouse-coverage-runlines (09-14); mix-surplus-ledger (09-15); automatic-build-version-reporting (10-03); source-based-readiness-identity (10-03); source-library-capture-endpoint (10-05).

## docs/superpowers/specs/ (43 design docs)

Highlights by theme:
- **Sync/SSE/streaming**: server-live-calc-stream-design + slices 2–6, sse-schedule-lease-refresh (09-16), screen-off-wake-section-snapshots (09-24), release-concurrency-stress (09-02)
- **Release/evidence**: release-check (08-22), recovery-audit (08-22), release-full-browser-regressions (09-24), release-workflow-staging (09-29), automatic-build-version-reporting (10-03), toolchain-browser-release-blockers (10-05), schema-safe-application-rollback-rehearsal (09-03)
- **AI**: gemini-live-failure-alert (08-25), gemini-manual-skill-trigger (08-25), ai-corrections-evaluation-data (10-02), per-pizza-advisory-review (10-04)
- **Domain**: ingredient-allergen-foundation (10-05), ingredient-catalog-dedupe (09-02), recipe-unit-confirmation (09-07), recipe-pool-freshness-fence (09-09), physical-line-pause-resume (09-03), packaging-autotrack-pause-handoff (08-27), warehouse-inventory-navigation (09-05), mix-surplus-ledger (09-15), production-data-health-check (08-20), data-health-workspace (08-27)
- **Import/sources**: spec-import-profile-repair (08-20), source-reconciliation-manager-owned-batch-size (09-08), source-library-capture-endpoint (10-05), source-based-readiness-identity (10-03), selected-pending-profile-snapshot (10-05)
- **E2E/testing**: e2e-isolation (08-21), sauce-recipe-refresh-e2e-startup (10-02), responsive-webkit-debug-evidence (10-02)

## docs/ highlights

qlora-distillation-techniques-2026-09-28, ai-phase0-adapter-dataset-design, allergen-tracking-plan, typescript-7-migration-research (governs the TS 6.0.3 ↔ 7.0.2 bridge), dependency-update-inventory series, sync-system-improvements-plan, stoppage-analytics-plan, production-reporting-plan.

## Usage

Before designing or changing anything in a covered area, open the newest matching plan/spec/research doc first. Prefer extending an existing dated plan over writing a parallel one. Research docs cite `research/sources/` snippets; keep the evidence boundary convention (no credentials, production payloads, or user identifiers in retained evidence).
