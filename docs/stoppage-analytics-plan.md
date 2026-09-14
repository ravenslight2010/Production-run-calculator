# Stoppage & Downtime Analytics — Plan

## Current State

| Feature | File | What It Does |
|---------|------|-------------|
| Stoppage log | run data `stoppages` array | Records reason, startedAt, endedAt, type per run |
| Downtime trends | `lib/downtime-trends/src/index.ts` | Aggregates stoppages across days |
| Trend buckets | `lib/downtime-trends/src/index.ts:80` | By type, by run, by hour, top reasons, longest |
| Stall detection | `lib/downtime-trends/src/index.ts` | "Line looks stalled" nudge |
| Downtime trends tab | `DowntimeTrendsTab.tsx` | Manager UI for trends |

### What's Missing
- No real-time stall alerts (only after-the-fact trends)
- No downtime cost tracking (lost production minutes × value)
- No automated root-cause classification (reasons are free text)
- No repetitive-downtime detection (same reason recurring)
- No downtime prediction
- No actionable recommendations
- No correlation between downtime and other factors (brand, shift, crew, hour)
- No automated downtime report (feeds into summary but isn't a standalone view)

---

## Proposed System

### 1. Real-Time Downtime Alerts
When a stoppage exceeds configurable threshold:
- On the Run tab: red banner "Line stopped for X min — reason: {reason}"
- If the same reason recurs 3+ times in a day: "Recurring issue: {reason} — consider contacting maintenance"
- Manager gets a highlight in the attention panel

**Threshold**: configurable (default 5 min)

### 2. Downtime Cost Tracking
Cost of downtime = lost production minutes × value per minute

**Value per minute** = (planned cases × case value) / run duration
- Configurable case value (per brand/flavor)
- Tracks both lost production AND wasted labor (idle staff during stops)

### 3. Reason Classification
Free-text reasons → auto-classify into categories:
- Equipment failure
- Material shortage
- Quality issue
- Operator action
- Maintenance
- Changeover
- Other

Uses a keyword classifier (pure function, shared lib). Managers can rename/merge categories.

### 4. Repetitive Downtime Detection
- Same classified reason occurring within a window → flag
- "Jam at wrapper" happened 5 times this week → "Repeat issue detected"
- Shows improvement/recurrence trend (was it better or worse than last week?)

### 5. Root-Cause Recommendations
After classifying, suggest known fixes:
- If reason maps to a known fix → show it
- If repeat issue → "Consider preventive maintenance"
- If correlating with a specific brand/flavor → note it

### 6. Downtime Correlations
Analyze patterns:
- By shift (which shift has more downtime?)
- By hour (which hour has peak stops?)
- By brand/flavor (which products run worst?)
- By crew (if crew attribution exists)
- Downtime vs. overproduction (are stops causing overruns?)

### 7. Downtime Prediction (Phase 3)
Simple heuristics:
- Based on recent history, estimate expected downtime for upcoming runs
- Flag runs likely to have high downtime (same brand/flavor as historically bad runs)

---

## Build Order

### Phase 1: Real-Time Alerts (highest value)
1. Configurable downtime threshold
2. Live red banner on Run tab when line stopped too long
3. Recurring-issue detection (same reason 3+ times)

### Phase 2: Classification & Cost
4. Reason auto-classification
5. Downtime cost calculator
6. Manager category merge UI

### Phase 3: Analytics & Prediction
7. Correlation analysis (shift, hour, brand)
8. Repetitive pattern detection with trend
9. Root-cause recommendations
10. Downtime prediction for upcoming runs

---

## Key Code References
| File | Purpose |
|------|---------|
| `lib/downtime-trends/src/index.ts` | Trends aggregation (extend) |
| `lib/downtime-trends/src/index.ts:80` | Buckets (extend with classifications) |
| `artifacts/run-calculator/src/components/DowntimeTrendsTab.tsx` | Trends UI (extend) |
| `artifacts/run-calculator/src/pages/home.tsx` | Run tab (add downtime alert banner) |
| `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` | Live run state (add stall alerts) |
| `lib/day-summary/src/index.ts` | Summary (link downtime cost) |
