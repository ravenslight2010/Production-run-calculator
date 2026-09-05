import { memo } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  ChevronDown,
  ClipboardCheck,
  ListChecks,
  Lock,
  Package,
  Snowflake,
  Square,
  Warehouse,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWarehouseTabCtx } from "../contexts/WarehouseTabCtx";
import { buildCycleCountDueList } from "@workspace/cycle-count";
import { normalizeScheduledDays } from "../scheduledDays";
import { computeSummaryStats, fmtTime, runLabel, todayStr } from "../utils";
import { loadRunValues } from "../storage";
import { DEFAULT_VALUES, type RunMeta } from "../types";
import { groupWarehouseNeedRows } from "../warehouseGrouping";
import { WarehouseNeedsList, type NeedRow } from "./WarehouseNeedsList";
import { FreezerSurplusPanel } from "./FreezerSurplusPanel";
import ReorderCard from "./ReorderCard";
import UseFirstCard from "./UseFirstCard";

export default memo(function WarehouseTabContent() {
  const {
    activePackagingRows, activeRunNeedDetails, activeRunValues, activeRuns, activeWarehouseRows,
    cycleCountSchedules, dayState, freezerPullPlan,
    freezerSurplus, freezerSurplusBusy, freezerSurplusError, freezerSurplusLoaded,
    isSupervisor, markCountedMutation,
    refreshFreezerSurplus, replaceRunSurplus, runValuesById,
    scheduledDays, scheduledValues, setPinError, setPinInput, setScheduleDeleteConfirm,
    setScheduledDays, setScheduleView, setShowPinDialog, setShowScheduleDialog,
    todayScheduledValues, toggleStagedItem,
  } = useWarehouseTabCtx();
  return (
    <>
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3" data-testid="warehouse-attention-header">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    <h2 className="text-sm font-bold">Warehouse attention</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pulls, counts, and stock alerts are shown first. Run-by-run staging details are below.
                  </p>
                </div>
                <FreezerSurplusPanel
                  mode="warehouse"
                  ledger={freezerSurplus}
                  loaded={freezerSurplusLoaded}
                  busy={freezerSurplusBusy}
                  error={freezerSurplusError}
                  pendingRuns={[
                    ...dayState.runs.filter((run: any) => !run.startedAt && !run.endedAt && !!run.brand),
                    ...scheduledDays.flatMap((day: any) =>
                      day.date === todayStr()
                        ? []
                        : (day.runs ?? [])
                          .filter((run: any) => !!run.brand)
                          .map((run: any, index: any) => ({
                            ...run,
                            id: (run as typeof run & { id?: string }).id ?? `${day.date}:${run.brand}:${run.flavor}:${index}`,
                            brand: run.brand,
                            flavor: run.flavor,
                            runDate: day.date,
                          } as RunMeta & { runDate: string; casesNeeded?: number })),
                    ),
                  ]}
                  getOriginalTarget={(run) =>
                    Number((run as RunMeta & { casesNeeded?: number }).casesNeeded) ||
                    Number(loadRunValues(run.id).casesNeeded) || 0}
                  onConfirm={async () => {}}
                  onAllocate={async (run, allocations) => {
                    await replaceRunSurplus(run, allocations);
                    await refreshFreezerSurplus();
                  }}
                />
                {/* Pull Out Freezer: for each upcoming scheduled run within an
                    item's days-early window whose recipe uses a tagged
                    freezer-pull ingredient, show what to pull now, grouped by
                    run date. Scheduled runs carry no recipe rows, so resolve
                    each via its profile -> FormValues -> need rows, exactly like
                    the schedule editor / per-run breakdown. */}
                {(() => {
                  const plan = freezerPullPlan;
                  if (plan.length === 0) return null;
                  return (
                    <div className="space-y-3 mb-4">
                      {plan.map((group: any) => (
                        <Card
                          key={group.date}
                          className="border-border/50 bg-card/60 shadow-md"
                          data-testid={`freezer-pull-${group.date}`}
                        >
                          <CardHeader className="pb-2 pt-4 px-5">
                            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <Snowflake className="w-4 h-4" /> Pull Out Freezer for {group.date}
                              <span className="ml-1 font-normal normal-case text-xs text-muted-foreground/70">
                                ({group.daysUntil === 0 ? "today" : `in ${group.daysUntil} day${group.daysUntil !== 1 ? "s" : ""}`})
                              </span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 pb-4 space-y-3">
                            {group.runs.map((run: any, ri: any) => (
                              <div key={ri} className="rounded-xl border border-border/50 bg-background/50 p-3">
                                <div className="font-semibold text-sm text-foreground mb-1.5 truncate">
                                  {run.brand}{run.flavor ? ` — ${run.flavor}` : ""}
                                </div>
                                <div className="space-y-1">
                                  {run.items.map((it: any, ii: any) => (
                                    <div key={ii} className="flex items-baseline justify-between gap-2 text-sm">
                                      <span className="text-muted-foreground min-w-0 truncate">
                                        {it.name}
                                        <span className="ml-1.5 text-[11px] text-amber-500/70">pull {it.daysEarly}d early</span>
                                      </span>
                                      <span className="font-bold tabular-nums whitespace-nowrap text-foreground">
                                        {it.quantity} <span className="font-normal text-muted-foreground/70">{it.unit}</span>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  );
                })()}
                {/* Time to Count: warehouse sections now due for a cycle count
                    (never counted, or last counted longer ago than their
                    cadence). Config is factory-wide manager master-data; any
                    signed-in user can mark a section counted, which stamps it
                    and clears it until the cadence elapses again. */}
                {(() => {
                  const due = buildCycleCountDueList({
                    schedules: cycleCountSchedules,
                    today: todayStr(),
                  });
                  if (due.length === 0) return null;
                  return (
                    <Card
                      className="border-border/50 border-l-4 border-l-amber-500 bg-card/60 shadow-md mb-4"
                      data-testid="cycle-count-due"
                    >
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <ClipboardCheck className="w-4 h-4" /> Time to Count
                          <span className="ml-1 font-normal normal-case text-xs text-amber-500/80">
                            ({due.length} section{due.length !== 1 ? "s" : ""} due)
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 space-y-2">
                        {due.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/50 p-3"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-foreground truncate">
                                {d.section}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {d.daysSince === null
                                  ? `Never counted · every ${d.cadenceDays}d`
                                  : `Last counted ${d.lastCountedAt} · ${d.daysSince}d ago${d.overdueDays > 0 ? ` (${d.overdueDays}d over)` : ""}`}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => markCountedMutation.mutate(d.id)}
                              disabled={markCountedMutation.isPending}
                              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-semibold disabled:opacity-50"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" /> Mark counted
                            </button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })()}
                {/* Reorder Now: cross-location on-hand at/below reorder threshold
                    once upcoming scheduled-run demand is subtracted. Scheduled
                    runs carry no recipe rows, so resolve each via its profile ->
                    FormValues (same pattern as the freezer-pull / per-run blocks)
                    and feed them as the demand basis. Advisory only. */}
                <ReorderCard scheduledValsList={scheduledValues} />
                {/* Use First: stock lots expiring within the configured window
                    (plus any already past), ordered first-expired-first-out, with
                    the lots used by today's runs surfaced to the top. Today's runs
                    = active runs + runs scheduled for today, resolved to their
                    FormValues. Deterministic counterpart to the AI waste insight;
                    advisory only. */}
                <UseFirstCard todayValsList={[...activeRunValues, ...todayScheduledValues]} />
                {(() => {
                  const agg = activeWarehouseRows;
                  const pkg = activePackagingRows;
                  return (
                    <>
                      <Card className="bg-card/60 border-border/50 shadow-md mb-4">
                        <CardHeader className="pb-2 pt-4 px-5">
                          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Warehouse className="w-4 h-4" /> Total Ingredient Needs — All Runs
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                          <WarehouseNeedsList rows={agg} />
                        </CardContent>
                      </Card>
                      {pkg.length > 0 && (
                        <Card className="bg-card/60 border-border/50 shadow-md mb-4">
                          <CardHeader className="pb-2 pt-4 px-5">
                            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <Package className="w-4 h-4" /> Packaging Needs — All Runs
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 pb-4">
                            <WarehouseNeedsList rows={pkg} />
                          </CardContent>
                        </Card>
                      )}
                    </>
                  );
                })()}
                {/* Per-run breakdown: what each active run needs and roughly how
                    long it runs, so warehouse staff can stage materials run by
                    run instead of reading off one combined total. Reuses the
                    same need/packaging math as the roll-up above. */}
                {(() => {
                  if (activeRuns.length === 0) return null;
                  return (
                    <details className="group mb-4 rounded-xl border border-border/50 bg-card/60 shadow-md" data-testid="warehouse-run-details">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 select-none">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          <ListChecks className="h-4 w-4 shrink-0" /> What Each Run Needs
                          <span className="normal-case tracking-normal text-xs font-normal">({activeRuns.length} active)</span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                      </summary>
                      <div className="border-t border-border/40 px-4 pb-4 pt-4 space-y-3">
                        {activeRuns.map((r: any) => {
                          const detail = activeRunNeedDetails.get(r.id);
                          const vals = runValuesById.get(r.id) ?? DEFAULT_VALUES;
                          const s = detail?.summary ?? computeSummaryStats(vals);
                          const rows = detail?.rows ?? [];
                          const estSec = s.estimatedTimeSec;
                          const staged = dayState.stagedItems ?? {};
                          const stagedCount = rows.filter((row: NeedRow) => staged[`${r.id}::${row.label}__${row.sub ?? ""}`]).length;
                          return (
                            <div key={r.id} className="rounded-md border border-border/40 bg-muted/10 p-3" data-testid={`warehouse-run-${r.id}`}>
                              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                                <span className="font-semibold text-sm truncate">{runLabel(r)}</span>
                                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                                  {rows.length > 0 ? `${stagedCount}/${rows.length} staged · ` : ""}{s.totalCases} case{s.totalCases !== 1 ? "s" : ""}{estSec > 0 ? ` · ~${fmtTime(estSec)}` : ""}
                                </span>
                              </div>
                              {rows.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">No materials configured yet.</p>
                              ) : (
                                <div className="space-y-4">
                                  {groupWarehouseNeedRows(rows).map((group) => (
                                    <section key={group.area} aria-label={`${group.area} needs`}>
                                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        {group.area}
                                      </h3>
                                      <div className="space-y-1">
                                  {group.rows.map((row) => {
                                    const rowKey = `${row.label}__${row.sub ?? ""}`;
                                    const checked = !!staged[`${r.id}::${rowKey}`];
                                    return (
                                      <button
                                        key={`${group.area}::${rowKey}`}
                                        type="button"
                                        onClick={() => toggleStagedItem(r.id, rowKey)}
                                        aria-pressed={checked}
                                        data-testid={`stage-${r.id}-${rowKey}`}
                                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted/40 transition-colors"
                                      >
                                        {checked ? (
                                          <CheckSquare className="w-4 h-4 shrink-0 text-primary" />
                                        ) : (
                                          <Square className="w-4 h-4 shrink-0 text-muted-foreground/60" />
                                        )}
                                        <span className={`flex-1 truncate ${checked ? "line-through text-muted-foreground" : "text-muted-foreground"}`}>{row.label}</span>
                                        <span className={`font-bold tabular-nums whitespace-nowrap ${checked ? "text-muted-foreground" : "text-foreground"}`}>
                                          {row.value} <span className="font-normal text-muted-foreground">{row.sub}</span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                      </div>
                                    </section>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })()}
                <Card className="bg-card/60 border-border/50 shadow-md mb-4">
                  <CardHeader className="pb-2 pt-4 px-5">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <CalendarDays className="w-4 h-4" /> Production Schedule
                      </CardTitle>
                      <button
                        type="button"
                        onClick={() => {
                          if (!isSupervisor) { setPinInput(""); setPinError(""); setShowPinDialog(true); return; }
                          fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(normalizeScheduledDays(d))).catch(() => {}); setScheduleView("list"); setScheduleDeleteConfirm(null); setShowScheduleDialog(true);
                        }}
                        title={isSupervisor ? "Manage production schedule" : "Supervisor only — tap to enter PIN"}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
                      >
                        {isSupervisor ? <CalendarPlus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} Manage
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {scheduledDays.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No upcoming days scheduled. Tap Manage to plan future production.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {scheduledDays.map((day: any) => (
                          <div key={day.date} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-muted/20 border border-border/30 text-sm">
                            <span className="font-medium">{day.date}</span>
                            <span className="text-xs text-muted-foreground">{day.runCount} run{day.runCount !== 1 ? "s" : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
    </>
  );
});
