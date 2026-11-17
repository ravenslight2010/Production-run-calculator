import { useState } from "react";
import type { ElementType } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { applyRecipeSubstitutions } from "@workspace/inventory-math";
import type { FormValues, IngredientSubstitution, RecipeRow } from "../../types";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { fmtNum } from "../../utils";

export function StatRow({
  label,
  value,
  testId,
  highlight,
  sub,
}: {
  label: string;
  value: string;
  testId?: string;
  highlight?: boolean;
  sub?: string;
}) {
  return (
    <div
      className={`flex items-start justify-between py-1.5 border-b border-border/40 last:border-0 ${highlight ? "text-primary" : ""}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-col items-end gap-0.5">
        <span
          className={`font-mono font-semibold text-sm tabular-nums ${highlight ? "text-primary text-base" : "text-foreground"}`}
          data-testid={testId}
        >
          {value}
        </span>
        {sub && (
          <span className="text-xs text-muted-foreground font-normal leading-tight">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

export function ReadOnlyRecipeCard({
  title,
  subtitle,
  recipe,
  substitutions,
  accent,
  scalable = false,
}: {
  title: string;
  subtitle?: string;
  recipe: RecipeRow[];
  /** Today's temporary overlay; applied only to the display copy. */
  substitutions?: IngredientSubstitution[];
  accent: string;
  scalable?: boolean;
}) {
  const effectiveRecipe = applyRecipeSubstitutions(recipe, substitutions);
  const rows = effectiveRecipe.rows.filter(
    r => (r.ingredient ?? "").trim() !== "" || Number(r.lbs ?? 0) > 0
  );
  const total = rows.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const SCALE_OPTIONS: { label: string; value: number }[] = [
    { label: "½", value: 0.5 },
    { label: "4", value: 1 },
    { label: "5", value: 1.25 },
    { label: "6", value: 1.5 },
  ];
  const [scale, setScale] = useState(1);
  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
      <div className={`h-1 ${accent} w-full`} />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center gap-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4" /> {title}
          </CardTitle>
          {subtitle ? (
            <span className="text-xs text-muted-foreground font-mono truncate max-w-[55%] text-right">{subtitle}</span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {effectiveRecipe.changed && (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" data-testid="temporary-read-only-recipe-overlay">
            Today&apos;s temporary substitution is reflected below. The saved recipe is unchanged.
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recipe configured. Add ingredients in Setup.</p>
        ) : (
          <div className="w-full">
            {scalable && (
              <div className="flex items-center flex-wrap gap-2 mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Batch Size</span>
                <div className="flex gap-1 rounded-lg bg-muted/30 p-1">
                  {SCALE_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setScale(opt.value)} className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${scale === opt.value ? "bg-orange-500 text-white" : "text-muted-foreground hover:bg-muted/50"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {scale !== 1 && <span className="text-[10px] text-muted-foreground">×{scale} — view only</span>}
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs / Batch</span>
            </div>
            <div className="space-y-0.5">
              {rows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 items-center py-1.5 px-1 rounded odd:bg-muted/20">
                  <span className="text-sm text-foreground">{r.ingredient || "—"}</span>
                  <span className="text-sm font-mono text-right text-foreground tabular-nums">{fmtNum(Number(r.lbs ?? 0) * scale, 1)}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
              <span className="text-xs font-mono text-right font-semibold text-foreground tabular-nums">{fmtNum(total * scale, 1)} lbs</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const AUTO_SUPPRESS_MS = 1 * 60 * 1000;

export function fmtMS(totalSec: number): string {
  if (!Number.isFinite(totalSec)) return "—:—";
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SecondsField({
  control,
  name,
  label,
}: {
  control: any;
  name: keyof FormValues;
  label: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0 space-y-0">
          <FormLabel className="text-[10px] text-muted-foreground block truncate font-normal">{label}</FormLabel>
          <FormControl>
            <div className="flex items-center gap-1 mt-0.5">
              <input type="number" inputMode="numeric" min={0} {...field} value={field.value ?? 0}
                onChange={(e) => { const val = e.target.value === "" ? "" : Number(e.target.value); if (val === "" || (Number.isFinite(val) && val >= 0)) field.onChange(val); }}
                onFocus={(e) => e.target.select()} className="h-7 w-full min-w-0 rounded-md border border-input bg-background/50 text-center font-mono text-xs font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" data-testid={`input-${name}`} />
              <span className="text-[10px] text-muted-foreground shrink-0 font-mono">= {fmtMS(Number(field.value) || 0)}</span>
            </div>
          </FormControl>
        </FormItem>
      )}
    />
  );
}

export function TimelineNode({ icon: Icon, active, done, last }: {
  icon: ElementType;
  active?: boolean;
  done?: boolean;
  last?: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center w-10 shrink-0 mr-3 pt-2">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center z-10 border-2 ${done ? "bg-emerald-950/80 border-emerald-600/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : active ? "bg-primary/20 border-primary/50 text-primary shadow-[0_0_15px_rgba(255,149,0,0.3)]" : "bg-muted/50 border-muted text-muted-foreground"}`}>
        {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
      </div>
      {!last && <div className={`w-1 grow mt-2 mb-[-8px] rounded-full ${done ? "bg-emerald-600/30" : active ? "bg-gradient-to-b from-primary/50 to-muted" : "bg-muted"}`} />}
    </div>
  );
}

export function PkgMiniStepper({ value, onDec, onInc, max, label }: {
  value: number; onDec: () => void; onInc: () => void; max?: number; label: string;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/80 mb-1 truncate">{label}</p>
      <div className="flex items-stretch h-10 w-full">
        <button type="button" onClick={() => { navigator.vibrate?.(8); onDec(); }} className="w-10 rounded-l-md border border-r-0 border-amber-700/30 bg-amber-950/50 hover:bg-amber-900/50 text-xl font-bold text-amber-400 transition-colors shrink-0 active:bg-amber-900/80 select-none">−</button>
        <div className={`flex-1 border-y border-amber-700/30 bg-background/20 flex items-center justify-center text-lg font-mono font-bold tabular-nums${atMax ? " text-amber-500" : " text-amber-100"}`}>{value}{max !== undefined && <span className="text-xs text-amber-500/70 ml-1 font-sans font-normal">/{max}</span>}</div>
        <button type="button" onClick={() => { if (!atMax) { navigator.vibrate?.(8); onInc(); } }} disabled={atMax} className={`w-10 rounded-r-md border border-l-0 border-amber-700/30 bg-amber-950/50 hover:bg-amber-900/50 text-xl font-bold text-amber-400 transition-colors shrink-0 active:bg-amber-900/80 select-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`}>+</button>
      </div>
    </div>
  );
}