import { memo, useState } from "react";
import { AlertTriangle, Blend, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMixesTabCtx } from "../contexts/MixesTabCtx";
import { buildMixPlan } from "@workspace/mixes";
import { computeCheesePerPizzaOz, computeSummaryStats, fmtComma, fmtNum, todayStr } from "../utils";
import { loadProfile, loadRunValues } from "../storage";
import { DEFAULT_VALUES, type FormValues } from "../types";
import { saveMixes } from "@/mixes";
import { MixAlreadyMadeInput } from "./MixAlreadyMadeInput";
import { PrepMixMissingAmountsWarning } from "./PrepMixMissingAmountsWarning";

// Memo'd Mix Plan panel extracted from home.tsx (refactor step 4b). Reads the
// narrow MixesTabCtx so manage/merge/import dialog churn no longer re-renders
// it. `prepMixExpanded` (pure UI expand/collapse state) moved to local state —
// it no longer re-renders all of Home.
export default memo(function MixesTabContent() {
  const ctx = useMixesTabCtx();
  const [prepMixExpanded, setPrepMixExpanded] = useState<Set<string>>(new Set());
  // Pre-blended mixes made ahead for a product. Pick a make-day; for every
  // scheduled run within a matching mix's days-early window, show per-product
  // cards with cases/pizzas, batches to make, total lbs, and a "Pull For Mix"
  // per-component lbs breakdown. Scheduled runs carry no recipe rows, so resolve
  // each via its profile -> FormValues -> computeSummaryStats for pizza/case
  // counts, exactly like the warehouse card. Advisory only — never moves stock.
  return (
    <div className="space-y-4 max-w-2xl mx-auto pb-8">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Blend className="w-5 h-5 text-emerald-400" />
                    <h2 className="text-lg font-semibold">Mix Plan</h2>
                    <p className="basis-full text-sm text-muted-foreground">
                      Plan which mixes to make ahead for upcoming scheduled production.
                    </p>
                  </div>
                  <Card>
                    <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap">
                      <label htmlFor="mix-make-day" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                        Make day
                      </label>
                      <Input
                        id="mix-make-day"
                        type="date"
                        value={ctx.mixMakeDay}
                        onChange={(e) => ctx.setMixMakeDay(e.target.value || todayStr())}
                        className="w-auto"
                        data-testid="mix-make-day"
                      />
                    </CardContent>
                  </Card>
                  {(() => {
                    if (ctx.mixes.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground px-1">
                          No mix recipes defined yet.{ctx.canManageInventory ? " Add them under Settings → Mix Recipes." : " Ask a manager to add them under Settings."}
                        </p>
                      );
                    }
                    // Helper: resolve a FormValues → MixScheduledRun shape. Used for
                    // both today's live runs and future scheduled runs so the
                    // ingredient extraction logic stays in one place.
                    const valsToMixRun = (date: string, brand: string, flavor: string, vals: FormValues) => {
                      const s = computeSummaryStats(vals);
                      const ingredientOzPerPizza: Record<string, number> = {};
                      const addSlot = (
                        recipe: typeof vals.app1CheeseRecipe,
                        type: string,
                        oz: number,
                      ) => {
                        if (recipe.length > 0 && oz > 0) {
                          const { rows } = computeCheesePerPizzaOz(recipe, oz);
                          recipe.forEach((row, i) => {
                            if (row.ingredient)
                              ingredientOzPerPizza[row.ingredient] =
                                (ingredientOzPerPizza[row.ingredient] ?? 0) + rows[i];
                          });
                        } else if (type && oz > 0) {
                          ingredientOzPerPizza[type] =
                            (ingredientOzPerPizza[type] ?? 0) + oz;
                        }
                      };
                      addSlot(vals.app1CheeseRecipe, vals.app1Type, vals.app1OzPerPizza);
                      addSlot(vals.app2CheeseRecipe, vals.app2Type, vals.app2OzPerPizza);
                      addSlot(vals.app3CheeseRecipe, vals.app3Type, vals.app3OzPerPizza);
                      addSlot(vals.app4CheeseRecipe, vals.app4Type, vals.app4OzPerPizza);
                      if (vals.pep1Type && vals.pep1OzPerPizza > 0)
                        ingredientOzPerPizza[vals.pep1Type] = (ingredientOzPerPizza[vals.pep1Type] ?? 0) + vals.pep1OzPerPizza;
                      if (vals.pep2Type && vals.pep2OzPerPizza > 0)
                        ingredientOzPerPizza[vals.pep2Type] = (ingredientOzPerPizza[vals.pep2Type] ?? 0) + vals.pep2OzPerPizza;
                      if (vals.pep1TypeB && (vals.pep1OzPerPizzaB ?? 0) > 0)
                        ingredientOzPerPizza[vals.pep1TypeB] = (ingredientOzPerPizza[vals.pep1TypeB] ?? 0) + (vals.pep1OzPerPizzaB ?? 0);
                      if (vals.pep2TypeB && (vals.pep2OzPerPizzaB ?? 0) > 0)
                        ingredientOzPerPizza[vals.pep2TypeB] = (ingredientOzPerPizza[vals.pep2TypeB] ?? 0) + (vals.pep2OzPerPizzaB ?? 0);
                      return {
                        date,
                        brand,
                        flavor,
                        // Use totalPizzasForSauce (adds the casesPerLayer startup
                        // buffer) so mixes and cheese-type mixes get the same
                        // buffer as applicator ingredients.
                        pizzas: s.totalPizzasForSauce,
                        cases: s.totalCases,
                        ingredients: Object.keys(ingredientOzPerPizza),
                        ingredientOzPerPizza,
                      };
                    };
                    // Today's live runs (dayState.runs) are NOT in the scheduled
                    // pool — they live in the live day state. Include them as
                    // date=today so the make-day plan works when today is selected.
                    const todayDateStr = todayStr();
                    const liveRunsForMixes = ctx.dayState.runs
                      .filter((r: any) => r.brand && !r.endedAt)
                      .map((r: any) => {
                        const runVals = ctx.effectiveValuesForRun(
                          r,
                          r.id === ctx.currentRunId ? ctx.form.getValues() : loadRunValues(r.id),
                        );
                        return valsToMixRun(todayDateStr, r.brand, r.flavor ?? "", runVals);
                      });
                    const runs = [
                      ...liveRunsForMixes,
                      ...ctx.scheduledDays.flatMap((day: any) =>
                        (day.runs ?? [])
                          .filter((r: any) => r.brand)
                          .map((r: any) => {
                            const profile = loadProfile(r.brand, r.flavor);
                            const vals: FormValues = {
                              ...(profile ?? DEFAULT_VALUES),
                              casesNeeded: r.casesNeeded,
                              ...(r.dieType ? { dieType: r.dieType } : {}),
                            };
                            return valsToMixRun(
                              day.date,
                              r.brand,
                              r.flavor,
                              ctx.effectiveValuesForRun(
                                {
                                  id: (r as typeof r & { id?: string }).id ?? `${day.date}:${r.brand}:${r.flavor}`,
                                  brand: r.brand,
                                  flavor: r.flavor,
                                },
                                vals,
                              ),
                            );
                          }),
                      ),
                    ];
                    const plan = buildMixPlan({ runs, mixes: ctx.mixPlanItems, today: ctx.mixMakeDay });
                    if (plan.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground px-1" data-testid="mix-plan-empty">
                          No mixes to make for this day. Pick a make-day with scheduled runs whose product matches a mix (within its days-early window).
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-3">
                        {plan.map((group) => (
                          <Card
                            key={group.date}
                            className="bg-emerald-950/30 border-emerald-700/40 shadow-md"
                            data-testid={`mix-plan-${group.date}`}
                          >
                            <CardHeader className="pb-2 pt-4 px-5">
                              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                                <Blend className="w-4 h-4" /> Mix Plan for {group.date}
                                <span className="ml-1 font-normal normal-case text-xs text-emerald-400/80">
                                  ({group.daysUntil === 0 ? "today" : `in ${group.daysUntil} day${group.daysUntil !== 1 ? "s" : ""}`})
                                </span>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="px-4 pb-4 space-y-3">
                              {group.runs.map((run, ri) => (
                                <div key={ri} className="rounded-md border border-emerald-800/40 bg-emerald-950/20 p-3">
                                  <div className="flex items-baseline justify-between gap-2 mb-2">
                                    <div className="font-semibold text-sm text-emerald-100 min-w-0 truncate">
                                      {run.brand}{run.flavor ? ` — ${run.flavor}` : ""}
                                    </div>
                                    <div className="text-xs text-emerald-300/80 whitespace-nowrap tabular-nums">
                                      {run.cases} case{run.cases !== 1 ? "s" : ""}
                                      {run.pizzas > 0 ? ` · ${run.pizzas} pizza${run.pizzas !== 1 ? "s" : ""}` : null}
                                    </div>
                                  </div>
                                  {run.cases > 0 && run.pizzas === 0 && (
                                    <div className="flex items-center gap-1.5 rounded bg-amber-900/30 border border-amber-700/40 px-2 py-1.5 mb-2 text-xs text-amber-300">
                                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                      Pizzas/case not set for this product — open Setup to enter it so lbs can be computed
                                    </div>
                                  )}
                                  <div className="space-y-2.5">
                                    {run.mixes.map((m) => (
                                      <div key={m.mixId} className="rounded border border-emerald-800/30 bg-emerald-900/10 p-2.5">
                                        <div className="flex items-baseline justify-between gap-2 mb-1">
                                          <span className="font-medium text-sm text-emerald-50 truncate">
                                            {m.name}
                                            {m.daysEarly > 0 && (
                                              <span className="ml-1.5 text-[11px] text-emerald-400/70">make {m.daysEarly}d early</span>
                                            )}
                                          </span>
                                          <span className="font-bold tabular-nums whitespace-nowrap text-emerald-50 text-sm">
                                            {m.batchSize > 0 ? (
                                              <>{fmtNum(m.batches, 2)} <span className="font-normal text-emerald-300/80">batch{m.batches === 1 ? "" : "es"}</span></>
                                            ) : (
                                              <span className="font-normal text-emerald-300/80 text-xs">no batch size</span>
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-2 text-xs text-emerald-300/80 mb-1.5 tabular-nums">
                                          <span>
                                            Total {fmtNum(m.totalLbs, 2)} lbs
                                            <span className="ml-1 text-emerald-400/70">(incl. 15% waste + {m.startupLbs} lb startup)</span>
                                          </span>
                                          {m.remainingLbs < m.totalLbs && (
                                            <span className="text-emerald-300">need {fmtNum(m.remainingLbs, 2)} lbs</span>
                                          )}
                                        </div>
                                        {/* Already made — controlled component so state stays stable during saves */}
                                        {(() => {
                                          const liveMix = ctx.mixPlanItems.find((mx: any) => mx.id === m.mixId);
                                          return liveMix ? (
                                            <MixAlreadyMadeInput
                                              mix={liveMix}
                                              saveMixes={saveMixes}
                                              onOptimisticSave={ctx.saveMixAlreadyMadeOptimistically}
                                              onSaveAcknowledged={ctx.acknowledgeMixAlreadyMadeSave}
                                            />
                                          ) : null;
                                        })()}
                                        {m.notes && (
                                          <div className="text-[11px] text-emerald-400/70 italic mb-1.5">{m.notes}</div>
                                        )}
                                        {m.missingAmounts && (
                                          <div className="flex items-center gap-1.5 rounded bg-amber-900/30 border border-amber-700/40 px-2 py-1.5 mb-1.5 text-xs text-amber-300">
                                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                            No oz/pizza amounts — open Mix Recipes to enter them
                                          </div>
                                        )}
                                        <div className="space-y-1 pt-1 border-t border-emerald-800/30">
                                          <div className="text-[11px] uppercase tracking-wider text-emerald-400/70 font-semibold pt-1">
                                            Pull For Mix
                                            {m.batchSize > 0 && m.batches > 0 && (
                                              <span className="ml-1.5 font-normal normal-case text-emerald-500/70">(per batch in parentheses)</span>
                                            )}
                                          </div>
                                          {m.components.length === 0 ? (
                                            <div className="text-xs text-emerald-400/60">No components defined.</div>
                                          ) : (
                                            m.components.map((c, ci) => {
                                              // Per-batch is a recipe spec — unchanged by already-made.
                                              const perBatch = m.batchSize > 0 && m.batches > 0 && m.totalLbs > 0
                                                ? (c.lbs / m.totalLbs) * m.batchSize
                                                : null;
                                              // Pull amount scales to remaining batches only.
                                              const pullLbs = m.totalLbs > 0
                                                ? c.lbs * m.remainingLbs / m.totalLbs
                                                : 0;
                                              return (
                                                <div key={ci} className="flex items-baseline justify-between gap-2 text-sm">
                                                  <span className="text-emerald-200/90 truncate">{c.ingredient}</span>
                                                  <span className="font-bold tabular-nums whitespace-nowrap text-emerald-50">
                                                    {fmtNum(pullLbs, 2)} <span className="font-normal text-emerald-300/80">lbs</span>
                                                    {perBatch !== null && (
                                                      <span className="font-normal text-emerald-400/70 ml-1.5">({fmtNum(perBatch, 2)}/batch)</span>
                                                    )}
                                                  </span>
                                                </div>
                                              );
                                            })
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                              {/* Prep mixes — ingredient-linked. Zero-pull cards (totalLbs === 0) are hidden;
                                  cards with totalLbs > 0 but remainingLbs === 0 still show so staff can confirm
                                  already-made coverage. */}
                              {(() => {
                                const visiblePrepMixes = group.prepMixes.filter((m) => m.totalLbs > 0);
                                return visiblePrepMixes.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-emerald-800/40 space-y-3">
                                  <p className="text-[11px] uppercase tracking-wider font-semibold text-violet-400/80">Ingredient Prep</p>
                                  {visiblePrepMixes.map((m) => {
                                    const expandKey = `${group.date}::${m.mixId}`;
                                    const isExpanded = prepMixExpanded.has(expandKey);
                                    const toggleExpanded = () =>
                                      setPrepMixExpanded((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(expandKey)) next.delete(expandKey);
                                        else next.add(expandKey);
                                        return next;
                                      });
                                    return (
                                    <div key={m.mixId} className="rounded-lg bg-violet-950/30 border border-violet-800/30 p-3 space-y-1.5">
                                      <div className="flex items-baseline justify-between gap-2">
                                        <span className="font-semibold text-sm text-violet-100">{m.name}</span>
                                        <span className="text-xs tabular-nums text-violet-300/80">
                                          {m.batchSize > 0 ? `${fmtNum(m.batches, 2)} batches` : <span className="text-violet-400/60">no batch size</span>}
                                        </span>
                                      </div>
                                      <div className="flex items-baseline justify-between gap-2 text-xs text-violet-300/80 tabular-nums">
                                        <span>Total {fmtNum(m.totalLbs, 2)} lbs <span className="text-violet-400/70">(incl. 15% waste + {m.startupLbs} lb startup)</span></span>
                                        {m.remainingLbs < m.totalLbs && <span>need {fmtNum(m.remainingLbs, 2)} lbs</span>}
                                      </div>
                                      {/* Per-run breakdown toggle — only when 2+ runs contribute */}
                                      {m.contributions && m.contributions.length >= 2 && (
                                        <div>
                                          <button
                                            type="button"
                                            onClick={toggleExpanded}
                                            className="flex items-center gap-1 text-[11px] text-violet-400/80 hover:text-violet-300 transition-colors"
                                          >
                                            <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                            {isExpanded ? "Hide" : "Show"} run breakdown ({m.contributions.length} runs)
                                          </button>
                                          {isExpanded && (
                                            <div className="mt-1.5 space-y-0.5 pl-4 border-l border-violet-700/40">
                                              {m.contributions.map((contrib, ci) => (
                                                <div key={ci} className="flex items-baseline justify-between gap-2 text-xs">
                                                  <span className="text-violet-300/80 truncate">
                                                    {contrib.brand}{contrib.flavor ? ` — ${contrib.flavor}` : ""}
                                                    <span className="ml-1 text-violet-400/60">({fmtComma(contrib.pizzas)} pizza{contrib.pizzas !== 1 ? "s" : ""})</span>
                                                  </span>
                                                  <span className="tabular-nums whitespace-nowrap text-violet-200/90 font-medium">
                                                    {fmtNum(contrib.totalLbs, 2)} <span className="font-normal text-violet-400/70">lbs</span>
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {(() => {
                                        const liveMix = ctx.mixPlanItems.find((mx: any) => mx.id === m.mixId);
                                        return liveMix ? (
                                          <MixAlreadyMadeInput
                                            mix={liveMix}
                                            saveMixes={saveMixes}
                                            onOptimisticSave={ctx.saveMixAlreadyMadeOptimistically}
                                            onSaveAcknowledged={ctx.acknowledgeMixAlreadyMadeSave}
                                          />
                                        ) : null;
                                      })()}
                                      <PrepMixMissingAmountsWarning entry={m} />
                                      {m.components.length > 0 && (
                                        <div className="space-y-1 pt-1 border-t border-violet-800/30">
                                          <p className="text-[11px] uppercase tracking-wider text-violet-400/70 font-semibold pt-1">Pull For Prep</p>
                                          {m.components.map((c, ci) => (
                                            <div key={ci} className="flex items-baseline justify-between gap-2 text-sm">
                                              <span className="text-violet-200/90 truncate">{c.ingredient}</span>
                                              <span className="font-bold tabular-nums whitespace-nowrap text-violet-50">
                                                {fmtNum(m.totalLbs > 0 ? c.lbs * m.remainingLbs / m.totalLbs : 0, 2)} <span className="font-normal text-violet-300/80">lbs</span>
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    );
                                  })}
                                </div>
                              );
                              })()}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    );
                  })()}
                </div>
  );
});
