# Production Reporting — Plan

## Current State

| Feature | File | What It Does |
|---------|------|-------------|
| Day summary | `lib/day-summary/src/index.ts` | Aggregates runs, cases planned vs produced, downtime, incidents |
| AI summary narration | `lib/day-summary/src/index.ts:255` | AI-generated plain-language recap |
| Fallback summary | `lib/day-summary/src/index.ts:293` | When AI unavailable, deterministic fallback text |
| Summary tools | `SummaryToolsContent.tsx` | UI for day/week summary |
| Operational report | `lib/day-summary/src/index.ts:29` | Server-authoritative report with freshness/attribution |
| History tracking | `completedRunHistoryTable` | DB persistence of completed runs |

### What's Missing
- No automated end-of-day report generation (runs at manager request only)
- No export to PDF/CSV
- No email/print distribution
- No multi-day trends (only day or week view)
- No per-brand/flavor production analytics
- No cost tracking per run
- No waste cost calculation
- No shift-level reporting
- No comparison to targets/baselines

---

## Proposed System

### 1. Automated Daily Report
At end of day (or on-demand), generate a complete production report:

**Report sections**:
- **Production Summary**: runs planned vs produced, cases planned vs actual, attainment %
- **Line Efficiency**: uptime %, total downtime, number of stoppages, average time between stops
- **Quality**: QC checks passed/failed, incidents reported, allergen compliance
- **Inventory**: items consumed, items low, items expiring, waste
- **Overproduction**: excess cases, disposition (stored/donated/discarded)
- **Mixes**: mixes made, leftover in freezer
- **Staff**: who was on which run, who did QC checks

### 2. Export Formats
- **PDF**: Formatted report for printing, management review
- **CSV**: Raw data export for spreadsheet analysis
- **JSON**: API endpoint for third-party integrations

### 3. Multi-Day Trends
- Weekly rollup (already exists, enhance)
- Monthly trends (cases produced, downtime %, waste %, cost trends)
- Brand/flavor production volume over time
- Seasonal patterns

### 4. Per-Run Cost Tracking
- Ingredient cost per run (from inventory valuation)
- Packaging cost per run
- Labor cost (if staff hours tracked)
- Total cost per case
- Cost vs. target comparison

### 5. Waste Cost Calculator
- Ingredient waste (overproduction, spoilage, spoilage)
- Packaging waste (damaged, misprinted)
- Labor waste (idle time during stoppages)
- Total waste cost per day

### 6. Comparison Views
- Day vs. day (yesterday vs. today)
- Week vs. week
- This month vs. last month
- Actual vs. target (if targets are set)

---

## Build Order

### Phase 1: Core Reports
1. Automated end-of-day report generation
2. PDF export
3. CSV export
4. Report history (past reports stored)

### Phase 2: Analytics
5. Multi-day trend charts
6. Brand/flavor production analytics
7. Per-run cost tracking

### Phase 3: Intelligence
8. Waste cost calculator
9. Comparison views
10. Target tracking

---

## Key Code References
| File | Purpose |
|------|---------|
| `lib/day-summary/src/index.ts` | Summary aggregation (extend) |
| `lib/day-summary/src/index.ts:255` | AI summary prompt (extend) |
| `artifacts/run-calculator/src/components/SummaryToolsContent.tsx` | Summary UI (extend) |
| `lib/db/src/schema/` | Add report storage tables |
| `artifacts/api-server/src/routes/` | Add report endpoints |
