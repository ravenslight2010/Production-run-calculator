import { memo } from "react";
import { BarChart2, ChevronDown } from "lucide-react";
import { useHomeTabCtx } from "../contexts/HomeTabCtx";
import OperationalReportPanel, { type OperationalReportDetailRange } from "./OperationalReportPanel";
import ManagerActionQueue from "./ManagerActionQueue";
import ShiftHandoffDigest from "./ShiftHandoffDigest";
import { buildDaySummaryInput, buildWeekSummaryInput } from "../aiSummary";
import { loadRunValues } from "../storage";
import { todayStr } from "../utils";
import type { HomeTab } from "../hooks/useHomeNavigation";

// Memo'd manager "Operations desk" tools header extracted from home.tsx
// (refactor step 5). Renders nothing for non-managers. Subscribes to the
// narrow HomeTabCtx (same as LiveSummaryTabContent), so manage/merge/import
// dialog churn does not re-render it.
export default memo(function SummaryToolsContent() {
  const {
    isManager, history, dayState, currentRunId, form,
    setActiveTab, setManageCategory, setShowManageDialog,
  } = useHomeTabCtx();

  if (!isManager) return null;

  return (
                  <div className="max-w-3xl mx-auto mb-4">
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2" data-testid="summary-tools-header">
                      <BarChart2 className="h-4 w-4 text-primary" />
                      <div>
                        <h2 className="text-sm font-bold">Operations desk</h2>
                        <p className="text-xs text-muted-foreground">Manager follow-up and shift context</p>
                      </div>
                    </div>
                    <div className="mb-3" data-testid="summary-priority-actions">
                      <ManagerActionQueue onNavigate={(tab) => setActiveTab(tab as HomeTab)} />
                    </div>
                    <ShiftHandoffDigest
                      onOpenSource={(source) => {
                        if (source === "incidents") { setActiveTab("incidents"); return; }
                        if (source === "quality") { setActiveTab("quality"); return; }
                        if (source === "inventory") { setActiveTab("warehouse"); return; }
                        setManageCategory("audit");
                        setShowManageDialog(true);
                      }}
                    />
                    <details className="group mt-3 rounded-xl border border-border/50 bg-card/40" data-testid="summary-report-details">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <BarChart2 className="h-4 w-4 text-muted-foreground" /> Reports and trends
                          <span className="text-xs font-normal text-muted-foreground">Generate or export a report</span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                      </summary>
                      <div className="border-t border-border/40 p-3">
                        <OperationalReportPanel
                          onOpenQuality={(range: OperationalReportDetailRange) => {
                            setActiveTab("quality");
                          }}
                          onOpenIncidents={(range: OperationalReportDetailRange) => {
                            setActiveTab("incidents");
                          }}
                          buildInput={(scope, date) =>
                            scope === "week"
                              ? buildWeekSummaryInput({
                                  date,
                                  nowMs: Date.now(),
                                  history: [
                                    ...history,
                                    {
                                      date: todayStr(),
                                      runs: dayState.runs,
                                      runValues: Object.fromEntries(
                                        dayState.runs.map((run: any) => [
                                          run.id,
                                          run.id === currentRunId
                                            ? form.getValues()
                                            : loadRunValues(run.id),
                                        ]),
                                      ),
                                    },
                                  ],
                                  runValuesForHistory: (day, run) => day.runValues?.[run.id],
                                })
                              : buildDaySummaryInput({
                                  date,
                                  nowMs: Date.now(),
                                  runs: dayState.runs,
                                  runValues: (run) =>
                                    run.id === currentRunId ? form.getValues() : loadRunValues(run.id),
                                })
                          }
                        />
                      </div>
                    </details>
                  </div>
  );
});
