import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Factory,
  Layers,
  Clock,
  Droplets,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Check,
  Play,
  Pause,
  Square,
  Timer,
  Trash2,
  X,
  BarChart2,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Settings,
  Download,
  Printer,
  History,
  FileText,
  AlertTriangle,
} from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const formSchema = z.object({
  // Line settings
  casesNeeded: z.coerce.number().min(0).default(384),
  crustsPerCycle: z.coerce.number().min(1).default(5),
  cycleSpeed: z.coerce.number().min(0.1).default(7.8),
  speedAdjustment: z.coerce.number().min(0.01).default(1.0),
  approxLineSpeed: z.coerce.number().min(0).default(39),
  freezerTime: z.coerce.number().min(0).default(15),
  pizzasPerCase: z.coerce.number().min(1).default(12),
  casesPerSkid: z.coerce.number().min(1).default(48),
  casesPerLayer: z.coerce.number().min(1).default(6),
  doughballsPerTray: z.coerce.number().min(1).default(24),
  crustsPerStack: z.coerce.number().min(1).default(24),
  doughBatchYield: z.coerce.number().min(1).default(620),
  crustsPerCase: z.coerce.number().min(1).default(12),
  // Progress tracking
  skidsCompleted: z.coerce.number().min(0).default(5),
  casesOnCurrentSkid: z.coerce.number().min(0).default(6),
  traysOnLine: z.coerce.number().min(0).default(43),
  batchesReady: z.coerce.number().min(0).default(0),
  // Frontline weights (oz per pizza application rate)
  sauceOzPerPizza: z.coerce.number().min(0).default(4),
  sauceBarrelLbs: z.coerce.number().min(0.1).default(450),
  app1OzPerPizza: z.coerce.number().min(0).default(0),
  app1BatchLbs: z.coerce.number().min(0.1).default(30),
  app2OzPerPizza: z.coerce.number().min(0).default(4),
  app2BatchLbs: z.coerce.number().min(0.1).default(55),
  app3OzPerPizza: z.coerce.number().min(0).default(0),
  app3BatchLbs: z.coerce.number().min(0.1).default(45),
  app4OzPerPizza: z.coerce.number().min(0).default(4),
  app4BatchLbs: z.coerce.number().min(0.1).default(55),
  pep1Sticks: z.coerce.number().min(0).default(0),
  pep1OzPerPizza: z.coerce.number().min(0).default(0),
  pep1BatchLbs: z.coerce.number().min(0.1).default(25),
  pep2Sticks: z.coerce.number().min(0).default(0),
  pep2OzPerPizza: z.coerce.number().min(0).default(0),
  pep2BatchLbs: z.coerce.number().min(0.1).default(25),
  // Applicator ingredient labels
  app1Type: z.string().default(""),
  app2Type: z.string().default(""),
  app3Type: z.string().default(""),
  app4Type: z.string().default(""),
  pep1Type: z.string().default(""),
  pep2Type: z.string().default(""),
  // Dough recipe
  doughRecipeName: z.string().default(""),
  targetDoughballWeight: z.coerce.number().min(0).default(0),
  doughRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  // Per-applicator cheese blend recipe rows
  app1CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  app2CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  app3CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  app4CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  frontlineRecipeName: z.string().default(""),
  frontlineRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
});

type FormValues = z.infer<typeof formSchema>;

function fmtTime(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtNum(n: number, dec = 2): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toFixed(dec);
}

function fmtComma(n: number, dec = 0): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function computeSummaryStats(vals: FormValues) {
  const totalPizzas = vals.casesNeeded * vals.pizzasPerCase;
  const totalPizzasForSauce = totalPizzas + vals.casesPerLayer * vals.pizzasPerCase;
  const sauceBatches =
    vals.sauceBarrelLbs > 0
      ? (totalPizzasForSauce * vals.sauceOzPerPizza) / (vals.sauceBarrelLbs * 16)
      : 0;
  const app1Lbs = (totalPizzas * vals.app1OzPerPizza) / 16 + 20;
  const app1IsMix = vals.app1Type.trim().toLowerCase().includes("mix");
  const app1Batches = !app1IsMix && vals.app1BatchLbs > 0 ? app1Lbs / vals.app1BatchLbs : 0;
  const app2Lbs = (totalPizzas * vals.app2OzPerPizza) / 16 + 20;
  const app2IsMix = vals.app2Type.trim().toLowerCase().includes("mix");
  const app2Batches = !app2IsMix && vals.app2BatchLbs > 0 ? app2Lbs / vals.app2BatchLbs : 0;
  const app3Lbs = (totalPizzas * vals.app3OzPerPizza) / 16 + 20;
  const app3IsMix = vals.app3Type.trim().toLowerCase().includes("mix");
  const app3Batches = !app3IsMix && vals.app3BatchLbs > 0 ? app3Lbs / vals.app3BatchLbs : 0;
  const app4Lbs = (totalPizzas * vals.app4OzPerPizza) / 16 + 20;
  const app4IsMix = vals.app4Type.trim().toLowerCase().includes("mix");
  const app4Batches = !app4IsMix && vals.app4BatchLbs > 0 ? app4Lbs / vals.app4BatchLbs : 0;
  const pep1Lbs = (totalPizzas * vals.pep1OzPerPizza) / 16 + vals.pep1Sticks;
  const pep1Batches =
    !DEFAULT_PEP_TYPES.includes(vals.pep1Type ?? "") && vals.pep1BatchLbs > 0
      ? pep1Lbs / vals.pep1BatchLbs
      : 0;
  const pep2Lbs = (totalPizzas * vals.pep2OzPerPizza) / 16 + vals.pep2Sticks;
  const pep2Batches =
    !DEFAULT_PEP_TYPES.includes(vals.pep2Type ?? "") && vals.pep2BatchLbs > 0
      ? pep2Lbs / vals.pep2BatchLbs
      : 0;
  const ppm = vals.crustsPerCycle * vals.cycleSpeed * vals.speedAdjustment;
  const estimatedTimeSec = ppm > 0 ? (totalPizzas * 60) / ppm : 0;
  return {
    totalCases: vals.casesNeeded,
    totalPizzas,
    estimatedTimeSec,
    sauceBatches,
    app1Lbs, app1Batches, app1Type: vals.app1Type,
    app2Lbs, app2Batches, app2Type: vals.app2Type,
    app3Lbs, app3Batches, app3Type: vals.app3Type,
    app4Lbs, app4Batches, app4Type: vals.app4Type,
    pep1Lbs, pep1Batches, pep1Type: vals.pep1Type ?? "",
    pep2Lbs, pep2Batches, pep2Type: vals.pep2Type ?? "",
  };
}

function StatRow({
  label,
  value,
  testId,
  highlight,
}: {
  label: string;
  value: string;
  testId?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between py-2.5 border-b border-border/40 last:border-0 ${highlight ? "text-primary" : ""}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`font-mono font-semibold text-sm tabular-nums ${highlight ? "text-primary text-base" : "text-foreground"}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}

type RecipeRow = { ingredient: string; lbs: number };

function IngredientSelect({
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
  onRemoveOption: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [rect, setRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filtered = (options ?? []).filter(o =>
    o.toLowerCase().includes(inputVal.toLowerCase())
  );

  function openDropdown() {
    setInputVal("");
    setConfirmDelete(null);
    confirmDeleteRef.current = null;
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const dropdownH = Math.min(filtered.length * 32 + 80, 280);
      setDropUp(spaceBelow < dropdownH && r.top > dropdownH);
      setRect({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
    }
    setOpen(true);
  }

  const dropStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: rect.left,
        width: Math.max(rect.width, 192),
        zIndex: 9999,
        ...(dropUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      }
    : {};

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={openDropdown}
        className="flex items-center gap-1 h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm hover:bg-muted/70 transition-colors w-full justify-between"
      >
        <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground/50"}`}>
          {value || placeholder || "Select…"}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div
          style={dropStyle}
          className="bg-popover border border-border rounded-md shadow-xl py-1"
        >
          <input
            autoFocus
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && inputVal.trim()) {
                onAddOption(inputVal.trim());
                onChange(inputVal.trim());
                setOpen(false);
              }
              if (e.key === "Escape") setOpen(false);
            }}
            onBlur={() => setTimeout(() => { if (!confirmDeleteRef.current) setOpen(false); }, 150)}
            placeholder="Search or add…"
            className="w-full px-3 py-1.5 text-xs bg-transparent border-b border-border/50 outline-none"
          />
          <div className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.map(opt =>
              confirmDelete === opt ? (
                <div key={opt} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                  <span className="text-[10px] text-destructive font-semibold truncate">Remove "{opt}"?</span>
                  <span className="flex gap-1 shrink-0">
                    <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
                    <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteRef.current = null; setConfirmDelete(null); }}>No</button>
                  </span>
                </div>
              ) : (
                <div key={opt} className="flex items-center">
                  <button
                    type="button"
                    className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === opt ? "text-primary font-semibold" : ""}`}
                    onMouseDown={() => { onChange(opt); setOpen(false); }}
                  >
                    {opt}
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                    onMouseDown={e => { e.stopPropagation(); confirmDeleteRef.current = opt; setConfirmDelete(opt); }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            )}
            {inputVal.trim() && !(options ?? []).includes(inputVal.trim()) && (
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-muted transition-colors flex items-center gap-1"
                onMouseDown={() => { onAddOption(inputVal.trim()); onChange(inputVal.trim()); setOpen(false); }}
              >
                <Plus className="w-3 h-3" /> Add "{inputVal.trim()}"
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CheeseRecipeCard({
  label,
  batches,
  fields,
  recipe,
  fieldPrefix,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
}: {
  label: string;
  batches: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  fieldPrefix: string;
  register: any;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-amber-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {label} — Cheese Blend Recipe
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{fmtNum(batches, 2)}</span> batches
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">
            No ingredients yet. Add rows to build the blend.
          </p>
        ) : (
          <div className="w-full mb-3">
            <div className="grid grid-cols-[1fr_120px_120px_32px] gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs / Batch</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Total Lbs</span>
              <span />
            </div>
            <div className="space-y-1.5">
              {fields.map((field, idx) => {
                const rowLbs = Number(recipe[idx]?.lbs ?? 0);
                return (
                  <div key={field.id} className={`grid gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[1fr_120px_120px_auto]" : "grid-cols-[1fr_120px_120px_32px]"}`}>
                    <IngredientSelect
                      value={recipe[idx]?.ingredient ?? ""}
                      onChange={val => onSetIngredient(idx, val)}
                      options={ingredientOptions}
                      onAddOption={onAddIngredient}
                      onRemoveOption={onRemoveIngredient}
                    />
                    <input
                      {...register(`${fieldPrefix}.${idx}.lbs`, { valueAsNumber: true })}
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="0"
                      className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm text-right font-mono outline-none focus:border-primary/60 w-full"
                    />
                    <div className="h-8 px-2 rounded bg-muted/20 border border-border/20 text-sm text-right font-mono flex items-center justify-end text-foreground/80">
                      {fmtNum(rowLbs * batches, 1)}
                    </div>
                    {confirmIdx === idx ? (
                      <div className="flex items-center gap-1">
                        <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                        <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmIdx(idx)}
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[1fr_120px_120px_32px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total</span>
              <span className="text-xs font-mono text-right text-muted-foreground">
                {fmtNum(totalLbsPerBatch, 1)} lbs/batch
              </span>
              <span className="text-xs font-mono text-right font-semibold text-foreground">
                {fmtNum(totalLbsPerBatch * batches, 1)} lbs
              </span>
              <span />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onAppend}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Ingredient
        </button>
      </CardContent>
    </Card>
  );
}

function MixRecipeCard({
  label,
  totalRunLbs,
  fields,
  recipe,
  fieldPrefix,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
}: {
  label: string;
  totalRunLbs: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  fieldPrefix: string;
  register: any;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const rowTotal = (rowLbs: number) =>
    totalLbsPerBatch > 0 ? (rowLbs / totalLbsPerBatch) * totalRunLbs : 0;
  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-purple-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {label} — Mix Recipe
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{fmtNum(totalRunLbs, 1)}</span> lbs needed
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">
            No ingredients yet. Add rows to build the mix.
          </p>
        ) : (
          <div className="w-full mb-3">
            <div className="grid grid-cols-[1fr_120px_120px_32px] gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Oz / Pizza</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Total Lbs</span>
              <span />
            </div>
            <div className="space-y-1.5">
              {fields.map((field, idx) => {
                const rowLbs = Number(recipe[idx]?.lbs ?? 0);
                return (
                  <div key={field.id} className={`grid gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[1fr_120px_120px_auto]" : "grid-cols-[1fr_120px_120px_32px]"}`}>
                    <IngredientSelect
                      value={recipe[idx]?.ingredient ?? ""}
                      onChange={val => onSetIngredient(idx, val)}
                      options={ingredientOptions}
                      onAddOption={onAddIngredient}
                      onRemoveOption={onRemoveIngredient}
                    />
                    <input
                      {...register(`${fieldPrefix}.${idx}.lbs`, { valueAsNumber: true })}
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="0"
                      className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm text-right font-mono outline-none focus:border-primary/60 w-full"
                    />
                    <div className="h-8 px-2 rounded bg-muted/20 border border-border/20 text-sm text-right font-mono flex items-center justify-end text-foreground/80">
                      {fmtNum(rowTotal(rowLbs), 1)}
                    </div>
                    {confirmIdx === idx ? (
                      <div className="flex items-center gap-1">
                        <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                        <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmIdx(idx)}
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[1fr_120px_120px_32px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total</span>
              <span className="text-xs font-mono text-right text-muted-foreground">
                {fmtNum(totalLbsPerBatch, 2)} oz/pizza
              </span>
              <span className="text-xs font-mono text-right font-semibold text-foreground">
                {fmtNum(totalRunLbs, 1)} lbs
              </span>
              <span />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onAppend}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Ingredient
        </button>
      </CardContent>
    </Card>
  );
}

function DoughRecipeCard({
  batchesNeeded,
  fields,
  recipe,
  register,
  targetWeight,
  doughBatchYield,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  onTargetWeightChange,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
}: {
  batchesNeeded: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  register: any;
  targetWeight: number;
  doughBatchYield: number;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  onTargetWeightChange: (v: number) => void;
  recipeName: string;
  recipeNameOptions: string[];
  onAddRecipeName: (v: string) => void;
  onRemoveRecipeName: (v: string) => void;
  onRecipeNameChange: (v: string) => void;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const totalBatchWeight = totalLbsPerBatch * Math.max(1, batchesNeeded);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  // Recipe yield: how many doughballs does the batch make at the target weight?
  const recipeYield = targetWeight > 0 ? (totalLbsPerBatch * 16) / targetWeight : 0;
  // Run yield: what the line actually produced (from doughBatchYield field)
  const runYield = Number(doughBatchYield);
  const yieldDiff = runYield - recipeYield;

  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-orange-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center gap-3 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
            Dough Recipe
          </CardTitle>
          <div className="flex-1 max-w-xs">
            <IngredientSelect
              value={recipeName}
              onChange={onRecipeNameChange}
              options={recipeNameOptions}
              onAddOption={onAddRecipeName}
              onRemoveOption={onRemoveRecipeName}
              placeholder="Recipe name…"
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            <span className="font-mono text-foreground">{fmtNum(batchesNeeded, 2)}</span> batches needed
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {/* Target weight + yield comparison */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-3 rounded-lg bg-muted/30">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              Target Weight (oz)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={targetWeight || ""}
              onChange={e => onTargetWeightChange(Number(e.target.value))}
              placeholder="0.00"
              className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm font-mono outline-none focus:border-primary/60 w-full"
            />
          </div>
          <div className="p-3 rounded-lg bg-muted/30 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recipe Yield</p>
            <p className="text-xl font-mono font-bold text-foreground">
              {recipeYield > 0 ? fmtNum(recipeYield, 1) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">doughballs / batch</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Run Yield</p>
            <p className={`text-xl font-mono font-bold ${
              recipeYield > 0 && runYield > 0
                ? Math.abs(yieldDiff) < 0.5 ? "text-green-400"
                  : yieldDiff < 0 ? "text-red-400"
                  : "text-amber-400"
                : "text-foreground"
            }`}>
              {runYield > 0 ? fmtNum(runYield, 1) : "—"}
            </p>
            {recipeYield > 0 && runYield > 0 && (
              <p className="text-[10px] text-muted-foreground font-mono">
                {yieldDiff > 0 ? "+" : ""}{fmtNum(yieldDiff, 1)} vs recipe
              </p>
            )}
          </div>
        </div>

        {/* Ingredient rows */}
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">
            No ingredients yet. Add rows to build the recipe.
          </p>
        ) : (
          <div className="w-full mb-3">
            <div className="grid grid-cols-[1fr_120px_32px] gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs / Batch</span>
              <span />
            </div>
            <div className="space-y-1.5">
              {fields.map((field, idx) => (
                <div key={field.id} className={`grid gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[1fr_120px_auto]" : "grid-cols-[1fr_120px_32px]"}`}>
                  <IngredientSelect
                    value={recipe[idx]?.ingredient ?? ""}
                    onChange={val => onSetIngredient(idx, val)}
                    options={ingredientOptions}
                    onAddOption={onAddIngredient}
                    onRemoveOption={onRemoveIngredient}
                  />
                  <input
                    {...register(`doughRecipe.${idx}.lbs`, { valueAsNumber: true })}
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm text-right font-mono outline-none focus:border-primary/60 w-full"
                  />
                  {confirmIdx === idx ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmIdx(idx)}
                      className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_120px_32px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
              <span className="text-xs font-mono text-right font-semibold text-foreground">
                {fmtNum(totalLbsPerBatch, 1)} lbs
              </span>
              <span />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onAppend}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Ingredient
        </button>
      </CardContent>
    </Card>
  );
}

function FrontlineRecipeCard({
  fields,
  recipe,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
}: {
  fields: { id: string }[];
  recipe: RecipeRow[];
  register: any;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  recipeName: string;
  recipeNameOptions: string[];
  onAddRecipeName: (v: string) => void;
  onRemoveRecipeName: (v: string) => void;
  onRecipeNameChange: (v: string) => void;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-red-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Sauce Recipe
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">
            No ingredients yet. Add rows to build the recipe.
          </p>
        ) : (
          <div className="w-full mb-3">
            <div className="grid grid-cols-[1fr_120px_32px] gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs / Batch</span>
              <span />
            </div>
            <div className="space-y-1.5">
              {fields.map((field, idx) => (
                <div key={field.id} className={`grid gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[1fr_120px_auto]" : "grid-cols-[1fr_120px_32px]"}`}>
                  <IngredientSelect
                    value={recipe[idx]?.ingredient ?? ""}
                    onChange={val => onSetIngredient(idx, val)}
                    options={ingredientOptions}
                    onAddOption={onAddIngredient}
                    onRemoveOption={onRemoveIngredient}
                  />
                  <input
                    {...register(`frontlineRecipe.${idx}.lbs`, { valueAsNumber: true })}
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm text-right font-mono outline-none focus:border-primary/60 w-full"
                  />
                  {confirmIdx === idx ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmIdx(idx)}
                      className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_120px_32px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
              <span className="text-xs font-mono text-right font-semibold text-foreground">
                {fmtNum(totalLbsPerBatch, 1)} lbs
              </span>
              <span />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onAppend}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Ingredient
        </button>
      </CardContent>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 mt-5 first:mt-0">
      {children}
    </p>
  );
}

function TypeDropdown({
  label,
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  allowClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
  onRemoveOption: (v: string) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const filtered = options.filter(o =>
    o.toLowerCase().includes(inputVal.toLowerCase())
  );
  return (
    <div className="flex items-center justify-between mb-2 mt-5 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="relative">
        <button
          type="button"
          onClick={() => { setInputVal(""); setConfirmDelete(null); confirmDeleteRef.current = null; setOpen(true); }}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted/40 border border-border/40 text-xs font-semibold hover:bg-muted/70 transition-colors min-w-[110px] justify-between"
        >
          <span className={value ? "text-foreground" : "text-muted-foreground/50"}>
            {value || "Select…"}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>
        {open && (
          <div className="absolute z-50 top-full mt-1 right-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1">
            <input
              autoFocus
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && inputVal.trim()) {
                  onAddOption(inputVal.trim());
                  onChange(inputVal.trim());
                  setOpen(false);
                }
                if (e.key === "Escape") setOpen(false);
              }}
              onBlur={() => setTimeout(() => { if (!confirmDeleteRef.current) setOpen(false); }, 150)}
              placeholder="Search or add…"
              className="w-full px-3 py-1.5 text-xs bg-transparent border-b border-border/50 outline-none"
            />
            <div className="max-h-48 overflow-y-auto">
              {allowClear && value && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors italic"
                  onMouseDown={() => { onChange(""); setOpen(false); }}
                >
                  — None
                </button>
              )}
              {filtered.map(opt =>
                confirmDelete === opt ? (
                  <div key={opt} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                    <span className="text-[10px] text-destructive font-semibold truncate">Remove "{opt}"?</span>
                    <span className="flex gap-1 shrink-0">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteRef.current = null; setConfirmDelete(null); }}>No</button>
                    </span>
                  </div>
                ) : (
                  <div key={opt} className="flex items-center">
                    <button
                      type="button"
                      className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === opt ? "text-primary font-semibold" : ""}`}
                      onMouseDown={() => { onChange(opt); setOpen(false); }}
                    >
                      {opt}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                      onMouseDown={e => { e.stopPropagation(); confirmDeleteRef.current = opt; setConfirmDelete(opt); }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              )}
              {inputVal.trim() && !options.includes(inputVal.trim()) && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-muted transition-colors flex items-center gap-1"
                  onMouseDown={() => { onAddOption(inputVal.trim()); onChange(inputVal.trim()); setOpen(false); }}
                >
                  <Plus className="w-3 h-3" /> Add "{inputVal.trim()}"
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NumField({
  control,
  name,
  label,
  step,
  testId,
  disabled,
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  step?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground">{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              step={step ?? "any"}
              className="font-mono bg-background/50 h-9 text-sm"
              data-testid={testId ?? `input-${name}`}
              disabled={disabled}
              {...field}
              onChange={(e) =>
                field.onChange(e.target.value === "" ? "" : Number(e.target.value))
              }
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function StepperField({
  control,
  name,
  label,
  min = 0,
  step = 1,
  disabled,
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const current = Number(field.value) || 0;
        return (
          <FormItem>
            <FormLabel className="text-xs text-muted-foreground">{label}</FormLabel>
            <FormControl>
              <div className={`flex items-stretch${disabled ? " opacity-50 pointer-events-none" : ""}`}>
                <button
                  type="button"
                  onClick={() => field.onChange(Math.max(min, current - step))}
                  className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80"
                  data-testid={`btn-dec-${name}`}
                  disabled={disabled}
                >
                  −
                </button>
                <input
                  type="number"
                  {...field}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="h-12 flex-1 border border-input bg-background/50 text-center font-mono text-2xl font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0"
                  data-testid={`input-${name}`}
                  disabled={disabled}
                />
                <button
                  type="button"
                  onClick={() => field.onChange(current + step)}
                  className="h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80"
                  data-testid={`btn-inc-${name}`}
                  disabled={disabled}
                >
                  +
                </button>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

const DAY_KEY = "run-calc-day";
const INGREDIENT_TYPES_KEY = "run-calc-ingredient-types";
const DEFAULT_INGREDIENT_TYPES = [
  "Cheese", "Pepperoni", "Sausage",
  "Mushroom", "Green Pepper", "Onion", "Black Olive", "Ham", "Bacon", "Jalapeño",
];
const PEP_TYPES_KEY = "run-calc-pep-types";
const DEFAULT_PEP_TYPES = ["Pep - Cured", "Pep - Natural"];
const CHEESE_INGREDIENTS_KEY = "run-calc-cheese-ingredients";
const DEFAULT_CHEESE_INGREDIENTS = [
  "Mozzarella", "Cheddar", "Provolone", "Swiss", "Monterey Jack", "Parmesan",
];
const MIX_INGREDIENTS_KEY = "run-calc-mix-ingredients";
const DEFAULT_MIX_INGREDIENTS: string[] = [];
const DOUGH_INGREDIENTS_KEY = "run-calc-dough-ingredients";
const DEFAULT_DOUGH_INGREDIENTS = [
  "Flour", "Water", "Salt", "Yeast", "Oil", "Sugar",
];
const DOUGH_RECIPE_NAMES_KEY = "run-calc-dough-recipe-names";
const DEFAULT_DOUGH_RECIPE_NAMES: string[] = [];
const FRONTLINE_INGREDIENTS_KEY = "run-calc-frontline-ingredients";
const DEFAULT_FRONTLINE_INGREDIENTS = ["Flour", "Water", "Salt", "Sugar", "Oil", "Yeast"];
const FRONTLINE_RECIPE_NAMES_KEY = "run-calc-frontline-recipe-names";
const DEFAULT_FRONTLINE_RECIPE_NAMES: string[] = [];
const RUN_KEY = (id: string) => `run-calc-run-${id}`;
const PROFILE_KEY = (brand: string, flavor: string) =>
  `run-calc-profile-${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
const CRUST_PROFILE_KEY = (brand: string, flavor: string) =>
  `run-calc-crust-profile-${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
const CRUST_FIELDS = ["crustsPerCycle", "cycleSpeed", "speedAdjustment", "doughballsPerTray", "approxLineSpeed", "crustsPerStack", "crustsPerCase"] as const;
type CrustField = (typeof CRUST_FIELDS)[number];
const PROGRESS_FIELDS = ["skidsCompleted", "casesOnCurrentSkid", "traysOnLine", "batchesReady"] as const;
const BRANDS_KEY = "run-calc-brands";
const FLAVORS_KEY = "run-calc-flavors"; // legacy – kept so old data is not lost
const BRAND_FLAVORS_KEY = "run-calc-brand-flavors";
const SUPERVISOR_PIN_KEY = "run-calc-supervisor-pin";
const DEFAULT_SUPERVISOR_PIN = "1234";
const MAX_RUNS = 30;

type RunMeta = { id: string; brand: string; flavor: string; startedAt?: number; pausedAt?: number; endedAt?: number; subTab?: "dough" | "crusts"; notes?: string; actualCases?: number; wasteLbs?: number };
type DayState = { runs: RunMeta[]; currentIndex: number; date?: string };
type SyncPayload = { dayState: { runs: RunMeta[] }; runValues: Record<string, FormValues> };

type HistoryDay = { date: string; runs: RunMeta[]; runValues: Record<string, FormValues> };
const HISTORY_KEY = "run-calc-history";
const MAX_HISTORY_DAYS = 14;

function runLabel(r: RunMeta) {
  if (r.brand && r.flavor) return `${r.brand} – ${r.flavor}`;
  if (r.brand) return r.brand;
  if (r.flavor) return r.flavor;
  return "Unnamed Run";
}

function loadList(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as string[];
  } catch {}
  return fallback;
}

function saveList(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

function loadBrandFlavors(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(BRAND_FLAVORS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
    // Migrate: seed every existing brand with the old global flavors list
    const oldFlavors = loadList(FLAVORS_KEY, []);
    if (oldFlavors.length > 0) {
      const brands = loadList(BRANDS_KEY, []);
      const seeded: Record<string, string[]> = {};
      brands.forEach(b => { seeded[b] = [...oldFlavors]; });
      return seeded;
    }
  } catch {}
  return {};
}

function saveBrandFlavors(bf: Record<string, string[]>): void {
  try { localStorage.setItem(BRAND_FLAVORS_KEY, JSON.stringify(bf)); } catch {}
}

function loadProfile(brand: string, flavor: string): FormValues | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return null;
    const doughVals: Partial<FormValues> = JSON.parse(raw);
    // Load crust settings from their own independent key
    let crustVals: Partial<FormValues> = {};
    try {
      const crustRaw = localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor));
      if (crustRaw) crustVals = JSON.parse(crustRaw);
    } catch {}
    return { ...DEFAULT_VALUES, ...doughVals, ...crustVals };
  } catch {}
  return null;
}

function saveProfile(brand: string, flavor: string, values: FormValues): void {
  if (!brand && !flavor) return;
  // Save dough fields (everything except crust-specific and progress fields)
  const doughVals = { ...values } as Record<string, unknown>;
  CRUST_FIELDS.forEach((f) => delete doughVals[f]);
  PROGRESS_FIELDS.forEach((f) => delete doughVals[f]);
  try { localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(doughVals)); } catch {}
  // Save crust fields to their own independent key (also strip progress)
  const crustVals: Partial<Record<CrustField, unknown>> = {};
  CRUST_FIELDS.forEach((f) => { crustVals[f] = values[f]; });
  try { localStorage.setItem(CRUST_PROFILE_KEY(brand, flavor), JSON.stringify(crustVals)); } catch {}
}

const DEFAULT_VALUES: FormValues = {
  // Line settings — all blank/zero until the user fills them in
  casesNeeded: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  approxLineSpeed: 0,
  freezerTime: 0,
  pizzasPerCase: 0,
  casesPerSkid: 0,
  casesPerLayer: 0,
  doughballsPerTray: 0,
  crustsPerStack: 0,
  doughBatchYield: 0,
  crustsPerCase: 0,
  // Current progress — zero
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  // Sauce & applicators — zero
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  app1OzPerPizza: 0,
  app1BatchLbs: 0,
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Sticks: 0,
  pep1OzPerPizza: 0,
  pep1BatchLbs: 25,
  pep2Sticks: 0,
  pep2OzPerPizza: 0,
  pep2BatchLbs: 25,
  app1Type: "",
  app2Type: "",
  app3Type: "",
  app4Type: "",
  pep1Type: "",
  pep2Type: "",
  doughRecipeName: "",
  targetDoughballWeight: 0,
  doughRecipe: [],
  app1CheeseRecipe: [],
  app2CheeseRecipe: [],
  app3CheeseRecipe: [],
  app4CheeseRecipe: [],
  frontlineRecipeName: "",
  frontlineRecipe: [],
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function freshDayState(): DayState {
  return { runs: [{ id: genId(), brand: "", flavor: "" }], currentIndex: 0, date: todayStr() };
}

function loadDayState(): DayState {
  try {
    const raw = localStorage.getItem(DAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DayState;
      // Reset if stored date is missing or doesn't match today
      if (!parsed.date || parsed.date !== todayStr()) {
        return freshDayState();
      }
      // Migrate old shape { id, label } → { id, brand, flavor }
      const runs = parsed.runs.map((r: any) => ({
        id: r.id,
        brand: r.brand ?? (r.label ?? ""),
        flavor: r.flavor ?? "",
        startedAt: r.startedAt,
        pausedAt: r.pausedAt,
        endedAt: r.endedAt,
      }));
      return { ...parsed, runs, date: parsed.date ?? todayStr() };
    }
  } catch {}
  return freshDayState();
}

function saveDayState(ds: DayState): void {
  try { localStorage.setItem(DAY_KEY, JSON.stringify({ ...ds, date: todayStr() })); } catch {}
}

function loadHistory(): HistoryDay[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as HistoryDay[];
  } catch {}
  return [];
}

function archiveDayToHistory(ds: DayState, date: string): void {
  try {
    const history = loadHistory().filter(h => h.date !== date);
    const runValues: Record<string, FormValues> = {};
    for (const run of ds.runs) {
      const raw = localStorage.getItem(RUN_KEY(run.id));
      if (raw) runValues[run.id] = JSON.parse(raw);
    }
    const entry: HistoryDay = { date, runs: ds.runs, runValues };
    const trimmed = [entry, ...history].slice(0, MAX_HISTORY_DAYS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
}

function loadRunValues(id: string): FormValues {
  try {
    const raw = localStorage.getItem(RUN_KEY(id));
    if (raw) return { ...DEFAULT_VALUES, ...JSON.parse(raw) };
    // Migrate legacy single-run data to this run slot
    const legacy = localStorage.getItem("run-calc-v1");
    if (legacy) {
      const vals = { ...DEFAULT_VALUES, ...JSON.parse(legacy) };
      localStorage.setItem(RUN_KEY(id), JSON.stringify(vals));
      return vals;
    }
  } catch {}
  return DEFAULT_VALUES;
}

function saveRunValues(id: string, values: FormValues): void {
  try { localStorage.setItem(RUN_KEY(id), JSON.stringify(values)); } catch {}
}

export default function Home() {
  const [dayState, setDayState] = useState<DayState>(() => loadDayState());
  const currentRun = dayState.runs[dayState.currentIndex] ?? dayState.runs[0];
  const currentRunId = currentRun?.id ?? "";

  const [history, setHistory] = useState<HistoryDay[]>(() => loadHistory());
  const [expandedHistoryDay, setExpandedHistoryDay] = useState<string | null>(null);

  const [brands, setBrands] = useState<string[]>(() =>
    [...loadList(BRANDS_KEY, ["Lucia's"])].sort((a, b) => a.localeCompare(b))
  );
  const [brandFlavors, setBrandFlavors] = useState<Record<string, string[]>>(loadBrandFlavors);
  const [ingredientTypes, setIngredientTypes] = useState<string[]>(() =>
    [...loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES)].sort((a, b) => a.localeCompare(b))
  );

  function addIngredientType(name: string) {
    const trimmed = name.trim();
    if (!trimmed || ingredientTypes.includes(trimmed)) return;
    const updated = [...ingredientTypes, trimmed].sort((a, b) => a.localeCompare(b));
    setIngredientTypes(updated);
    saveList(INGREDIENT_TYPES_KEY, updated);
  }

  function removeIngredientType(name: string) {
    const updated = ingredientTypes.filter(t => t !== name);
    setIngredientTypes(updated);
    saveList(INGREDIENT_TYPES_KEY, updated);
  }

  const [pepTypes, setPepTypes] = useState<string[]>(() => {
    const LEGACY_PEP_TYPES = ["Natural", "Cured"];
    const saved = loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES);
    const merged = [...new Set([...DEFAULT_PEP_TYPES, ...saved.filter(t => !LEGACY_PEP_TYPES.includes(t))])].sort((a, b) => a.localeCompare(b));
    return merged;
  });

  function addPepType(name: string) {
    const trimmed = name.trim();
    if (!trimmed || pepTypes.includes(trimmed)) return;
    const updated = [...pepTypes, trimmed].sort((a, b) => a.localeCompare(b));
    setPepTypes(updated);
    saveList(PEP_TYPES_KEY, updated);
  }

  function removePepType(name: string) {
    if (DEFAULT_PEP_TYPES.includes(name)) return;
    const updated = pepTypes.filter(t => t !== name);
    setPepTypes(updated);
    saveList(PEP_TYPES_KEY, updated);
  }

  const [cheeseIngredients, setCheeseIngredients] = useState<string[]>(() =>
    loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS)
  );

  function addCheeseIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || cheeseIngredients.includes(trimmed)) return;
    const updated = [...cheeseIngredients, trimmed];
    setCheeseIngredients(updated);
    saveList(CHEESE_INGREDIENTS_KEY, updated);
  }

  function removeCheeseIngredient(name: string) {
    const updated = cheeseIngredients.filter(t => t !== name);
    setCheeseIngredients(updated);
    saveList(CHEESE_INGREDIENTS_KEY, updated);
  }

  const [mixIngredients, setMixIngredients] = useState<string[]>(() =>
    loadList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS)
  );

  function addMixIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || mixIngredients.includes(trimmed)) return;
    const updated = [...mixIngredients, trimmed];
    setMixIngredients(updated);
    saveList(MIX_INGREDIENTS_KEY, updated);
  }

  function removeMixIngredient(name: string) {
    const updated = mixIngredients.filter(t => t !== name);
    setMixIngredients(updated);
    saveList(MIX_INGREDIENTS_KEY, updated);
  }

  const [doughIngredients, setDoughIngredients] = useState<string[]>(() =>
    [...loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS)].sort((a, b) => a.localeCompare(b))
  );

  function addDoughIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || doughIngredients.includes(trimmed)) return;
    const updated = [...doughIngredients, trimmed].sort((a, b) => a.localeCompare(b));
    setDoughIngredients(updated);
    saveList(DOUGH_INGREDIENTS_KEY, updated);
  }

  function removeDoughIngredient(name: string) {
    const updated = doughIngredients.filter(t => t !== name);
    setDoughIngredients(updated);
    saveList(DOUGH_INGREDIENTS_KEY, updated);
  }

  const [doughRecipeNames, setDoughRecipeNames] = useState<string[]>(() =>
    [...loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES)].sort((a, b) => a.localeCompare(b))
  );

  function addDoughRecipeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed || doughRecipeNames.includes(trimmed)) return;
    const updated = [...doughRecipeNames, trimmed].sort((a, b) => a.localeCompare(b));
    setDoughRecipeNames(updated);
    saveList(DOUGH_RECIPE_NAMES_KEY, updated);
  }

  function removeDoughRecipeName(name: string) {
    const updated = doughRecipeNames.filter(t => t !== name);
    setDoughRecipeNames(updated);
    saveList(DOUGH_RECIPE_NAMES_KEY, updated);
  }

  const [frontlineIngredients, setFrontlineIngredients] = useState<string[]>(() =>
    [...loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS)].sort((a, b) => a.localeCompare(b))
  );
  function addFrontlineIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || frontlineIngredients.includes(trimmed)) return;
    const updated = [...frontlineIngredients, trimmed].sort((a, b) => a.localeCompare(b));
    setFrontlineIngredients(updated);
    saveList(FRONTLINE_INGREDIENTS_KEY, updated);
  }
  function removeFrontlineIngredient(name: string) {
    const updated = frontlineIngredients.filter(t => t !== name);
    setFrontlineIngredients(updated);
    saveList(FRONTLINE_INGREDIENTS_KEY, updated);
  }

  const [frontlineRecipeNames, setFrontlineRecipeNames] = useState<string[]>(() =>
    [...loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES)].sort((a, b) => a.localeCompare(b))
  );
  function addFrontlineRecipeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed || frontlineRecipeNames.includes(trimmed)) return;
    const updated = [...frontlineRecipeNames, trimmed].sort((a, b) => a.localeCompare(b));
    setFrontlineRecipeNames(updated);
    saveList(FRONTLINE_RECIPE_NAMES_KEY, updated);
  }
  function removeFrontlineRecipeName(name: string) {
    const updated = frontlineRecipeNames.filter(t => t !== name);
    setFrontlineRecipeNames(updated);
    saveList(FRONTLINE_RECIPE_NAMES_KEY, updated);
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: (() => {
      const ds = loadDayState();
      return loadRunValues(ds.runs[ds.currentIndex]?.id ?? "");
    })(),
    mode: "onChange",
  });

  const v = form.watch();

  const { fields: cheese1Fields, append: appendCheese1, remove: removeCheese1 } = useFieldArray({ control: form.control, name: "app1CheeseRecipe" });
  const { fields: cheese2Fields, append: appendCheese2, remove: removeCheese2 } = useFieldArray({ control: form.control, name: "app2CheeseRecipe" });
  const { fields: cheese3Fields, append: appendCheese3, remove: removeCheese3 } = useFieldArray({ control: form.control, name: "app3CheeseRecipe" });
  const { fields: cheese4Fields, append: appendCheese4, remove: removeCheese4 } = useFieldArray({ control: form.control, name: "app4CheeseRecipe" });
  const { fields: doughFields, append: appendDough, remove: removeDough } = useFieldArray({ control: form.control, name: "doughRecipe" });
  const { fields: frontlineFields, append: appendFrontline, remove: removeFrontline } = useFieldArray({ control: form.control, name: "frontlineRecipe" });

  const [activeTab, setActiveTab] = useState("info");
  const [doughSubTab, setDoughSubTab] = useState<"dough" | "crusts">("dough");
  const [nowTime, setNowTime] = useState(() => new Date());
  const [runToTime, setRunToTime] = useState("19:15");

  // Brand/flavor picker state
  const [brandInput, setBrandInput] = useState("");
  const [flavorInput, setFlavorInput] = useState("");
  const [showBrandDrop, setShowBrandDrop] = useState(false);
  const [showFlavorDrop, setShowFlavorDrop] = useState(false);
  const [confirmDeleteBrand, setConfirmDeleteBrand] = useState<string | null>(null);
  const [confirmDeleteFlavor, setConfirmDeleteFlavor] = useState<string | null>(null);
  const confirmDeleteBrandRef = useRef<string | null>(null);
  const confirmDeleteFlavorRef = useRef<string | null>(null);
  const [confirmRemoveRun, setConfirmRemoveRun] = useState(false);
  const [resumeDialog, setResumeDialog] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeTouchStart = useRef<{ x: number; y: number } | null>(null);

  // ── Role / Access ──────────────────────────────────────────────────────────
  const [role, setRole] = useState<"operator" | "supervisor">("operator");
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const isSupervisor = role === "supervisor";

  // ── Manage Lists dialog ────────────────────────────────────────────────────
  const [showManageDialog, setShowManageDialog] = useState(false);
  const [manageCategory, setManageCategory] = useState("brands");
  const [manageBrandFilter, setManageBrandFilter] = useState("");
  const [manageInput, setManageInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [pinChangeMsg, setPinChangeMsg] = useState("");

  // ── Sync refs ──────────────────────────────────────────────────────────────
  const clientId = useRef<string>(
    (() => {
      let id = sessionStorage.getItem("run-calc-client-id");
      if (!id) { id = genId(); sessionStorage.setItem("run-calc-client-id", id); }
      return id;
    })()
  );
  const dayStateRef = useRef(dayState);
  const lastLocalEditRef = useRef(0);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncApplyingRef = useRef(false);
  const applySyncCallbackRef = useRef<(p: SyncPayload) => void>(() => {});
  const initialFinishTimestampRef = useRef<number>(0);

  // Keep dayStateRef current
  useEffect(() => { dayStateRef.current = dayState; }, [dayState]);

  // Update the apply-sync callback so it always captures fresh form/state refs
  useEffect(() => {
    applySyncCallbackRef.current = (payload: SyncPayload) => {
      isSyncApplyingRef.current = true;
      for (const [id, vals] of Object.entries(payload.runValues)) {
        saveRunValues(id, vals as FormValues);
      }
      setDayState(prev => {
        const newRuns = payload.dayState.runs;
        const newIndex = Math.max(0, Math.min(prev.currentIndex, newRuns.length - 1));
        const newDs = { ...prev, runs: newRuns, currentIndex: newIndex };
        saveDayState(newDs);
        return newDs;
      });
      const currentId = dayStateRef.current.runs[dayStateRef.current.currentIndex]?.id;
      const currentRunInPayload = payload.dayState.runs.find(r => r.id === currentId);
      if (currentRunInPayload?.subTab) setDoughSubTab(currentRunInPayload.subTab);
      if (currentId && payload.runValues[currentId] && Date.now() - lastLocalEditRef.current > 2000) {
        form.reset({ ...DEFAULT_VALUES, ...(payload.runValues[currentId] as FormValues) });
      }
      requestAnimationFrame(() => { isSyncApplyingRef.current = false; });
    };
  });

  // SSE connection — receives updates from other clients
  useEffect(() => {
    const es = new EventSource("/api/sync/events?clientId=" + clientId.current);
    es.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { data: SyncPayload | null };
        if (msg.data) applySyncCallbackRef.current(msg.data);
      } catch {}
    };
    return () => es.close();
  }, []);

  // Detect day change while the tab is open (visibility change + periodic check)
  useEffect(() => {
    function checkDateRollover() {
      const stored = (() => {
        try { return JSON.parse(localStorage.getItem(DAY_KEY) ?? "{}") as { date?: string }; } catch { return {}; }
      })();
      if (stored.date && stored.date !== todayStr()) {
        // Archive yesterday before resetting
        const prevDs = (() => { try { return JSON.parse(localStorage.getItem(DAY_KEY) ?? "null") as DayState | null; } catch { return null; } })();
        if (prevDs && stored.date) archiveDayToHistory(prevDs, stored.date);
        const fresh = freshDayState();
        saveDayState(fresh);
        setDayState(fresh);
        form.reset(DEFAULT_VALUES);
      }
    }
    const interval = setInterval(checkDateRollover, 60_000);
    document.addEventListener("visibilitychange", checkDateRollover);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkDateRollover);
    };
  }, []);

  function schedulePush(ds: DayState, delay = 600) {
    if (isSyncApplyingRef.current) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    const curId = ds.runs[ds.currentIndex]?.id;
    pushTimerRef.current = setTimeout(() => {
      const runValues: Record<string, FormValues> = {};
      for (const run of ds.runs) {
        runValues[run.id] = run.id === curId ? form.getValues() : loadRunValues(run.id);
      }
      const payload: SyncPayload = { dayState: { runs: ds.runs }, runValues };
      fetch("/api/sync/today", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId: clientId.current, payload }),
      }).catch(() => {});
    }, delay);
  }
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (currentRunId) {
      saveRunValues(currentRunId, v);
      if (currentRun?.brand || currentRun?.flavor) {
        saveProfile(currentRun.brand, currentRun.flavor, v);
      }
      lastLocalEditRef.current = Date.now();
      schedulePush(dayStateRef.current);
      flashSaved();
    }
  }, [v, currentRunId]);

  function switchToRun(newIndex: number) {
    if (newIndex < 0 || newIndex >= dayState.runs.length) return;
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    const newId = dayState.runs[newIndex].id;
    const newDs = { ...dayState, currentIndex: newIndex };
    setDayState(newDs);
    saveDayState(newDs);
    form.reset(loadRunValues(newId));
    setDoughSubTab(dayState.runs[newIndex].subTab ?? "dough");
  }

  function addRun() {
    if (dayState.runs.length >= MAX_RUNS) return;
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    const newId = genId();
    const newIndex = dayState.runs.length;
    const newDs = {
      runs: [...dayState.runs, { id: newId, brand: "", flavor: "" }],
      currentIndex: newIndex,
    };
    setDayState(newDs);
    saveDayState(newDs);
    form.reset(DEFAULT_VALUES);
    schedulePush(newDs, 0);
  }

  function removeRun() {
    const idx = dayState.currentIndex;
    const run = dayState.runs[idx];
    if (!run || run.startedAt || run.endedAt) return; // active or completed — cannot remove
    const newRuns = dayState.runs.filter((_, i) => i !== idx);
    if (newRuns.length === 0) return; // always keep at least one run
    const newIndex = Math.max(0, idx - 1);
    const newDs = { ...dayState, runs: newRuns, currentIndex: newIndex };
    setDayState(newDs);
    saveDayState(newDs);
    form.reset(loadRunValues(newRuns[newIndex].id));
    schedulePush(newDs, 0);
    setConfirmRemoveRun(false);
  }

  function setRunBrandFlavor(brand: string, flavor: string) {
    // Save current values to old profile
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);

    // Update run meta
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, brand, flavor } : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);

    // Load profile for new brand+flavor if it exists
    const profile = loadProfile(brand, flavor);
    if (profile) form.reset(profile);
    schedulePush(newDs, 0);
  }

  function addBrand(name: string) {
    const trimmed = name.trim();
    if (!trimmed || brands.includes(trimmed)) return trimmed ? trimmed : brands[0];
    const updated = [...brands, trimmed].sort((a, b) => a.localeCompare(b));
    setBrands(updated);
    saveList(BRANDS_KEY, updated);
    return trimmed;
  }

  function removeBrand(name: string) {
    const updated = brands.filter(b => b !== name);
    setBrands(updated);
    saveList(BRANDS_KEY, updated);
  }

  function addFlavor(name: string, brand?: string) {
    const b = (brand ?? currentRun?.brand ?? "").trim();
    const trimmed = name.trim();
    if (!trimmed || !b) return trimmed;
    const current = brandFlavors[b] ?? [];
    if (current.includes(trimmed)) return trimmed;
    const next = { ...brandFlavors, [b]: [...current, trimmed].sort((a, bv) => a.localeCompare(bv)) };
    setBrandFlavors(next);
    saveBrandFlavors(next);
    return trimmed;
  }

  function removeFlavor(name: string, brand?: string) {
    const b = (brand ?? currentRun?.brand ?? "").trim();
    if (!b) return;
    const next = { ...brandFlavors, [b]: (brandFlavors[b] ?? []).filter(f => f !== name) };
    setBrandFlavors(next);
    saveBrandFlavors(next);
  }

  function checkPin() {
    const stored = localStorage.getItem(SUPERVISOR_PIN_KEY) ?? DEFAULT_SUPERVISOR_PIN;
    if (pinInput === stored) {
      setRole("supervisor");
      setShowPinDialog(false);
      setPinInput("");
      setPinError("");
    } else {
      setPinError("Incorrect PIN. Try again.");
    }
  }

  function startRun() {
    initialFinishTimestampRef.current = Date.now() + calc.totalTimeSec * 1000;
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, startedAt: Date.now(), endedAt: undefined } : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 0);
  }

  function pauseRun() {
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, pausedAt: Date.now() } : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 0);
  }

  function resumeRun(freezerEmpty: boolean) {
    const run = dayState.runs[dayState.currentIndex];
    if (!run?.pausedAt) return;
    let newStartedAt = run.startedAt!;
    if (freezerEmpty) {
      // Restart freezer from zero
      newStartedAt = Date.now();
    } else {
      // Shift startedAt forward by pause duration so elapsed time is preserved
      const pauseDuration = Date.now() - run.pausedAt;
      newStartedAt = run.startedAt! + pauseDuration;
    }
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, startedAt: newStartedAt, pausedAt: undefined }
        : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 0);
  }

  function endRun() {
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, pausedAt: undefined, endedAt: Date.now() } : r
    );
    const nextIndex = dayState.currentIndex + 1 < dayState.runs.length
      ? dayState.currentIndex + 1
      : dayState.currentIndex;
    const newDs = { ...dayState, runs: newRuns, currentIndex: nextIndex };
    setDayState(newDs);
    saveDayState(newDs);
    if (nextIndex !== dayState.currentIndex) {
      form.reset(loadRunValues(dayState.runs[nextIndex].id));
    }
    schedulePush(newDs, 0);
  }

  function flashSaved() {
    setSavedFlash(true);
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    savedFlashTimer.current = setTimeout(() => setSavedFlash(false), 1800);
  }

  function copyRun() {
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    const newId = genId();
    const newIndex = dayState.runs.length;
    // Copy meta (brand/flavor) but clear timing
    const newMeta: RunMeta = { id: newId, brand: currentRun?.brand ?? "", flavor: currentRun?.flavor ?? "" };
    const newDs = { ...dayState, runs: [...dayState.runs, newMeta], currentIndex: newIndex };
    setDayState(newDs);
    saveDayState(newDs);
    // Copy all form values except progress fields
    const copied = { ...cur, skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 };
    saveRunValues(newId, copied);
    form.reset(copied);
    schedulePush(newDs, 0);
  }

  function updateRunMeta(id: string, patch: Partial<RunMeta>) {
    const newRuns = dayState.runs.map(r => r.id === id ? { ...r, ...patch } : r);
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 600);
  }

  function exportCSV() {
    const rows: string[][] = [["Date", "Brand", "Flavor", "Status", "Cases Planned", "Cases Actual", "Waste Lbs", "Started", "Ended", "Duration", "Notes"]];
    for (const run of dayState.runs) {
      const vals = run.id === currentRunId ? v : loadRunValues(run.id);
      const s = computeSummaryStats(vals);
      const status = run.endedAt ? "Finished" : run.startedAt ? "Running" : "Upcoming";
      const dur = run.startedAt && run.endedAt ? fmtTime((run.endedAt - run.startedAt) / 1000) : "";
      rows.push([
        todayStr(), run.brand, run.flavor, status,
        String(s.totalCases), String(run.actualCases ?? ""),
        String(run.wasteLbs ?? ""),
        run.startedAt ? fmtClock(run.startedAt) : "",
        run.endedAt ? fmtClock(run.endedAt) : "",
        dur,
        (run.notes ?? "").replace(/"/g, '""'),
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `production-run-${todayStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportHistoryCSV(day: HistoryDay) {
    const rows: string[][] = [["Date", "Brand", "Flavor", "Status", "Cases Planned", "Cases Actual", "Waste Lbs", "Started", "Ended", "Duration", "Notes"]];
    for (const run of day.runs) {
      const vals = day.runValues[run.id] ?? DEFAULT_VALUES;
      const s = computeSummaryStats(vals as FormValues);
      const status = run.endedAt ? "Finished" : run.startedAt ? "Running" : "Upcoming";
      const dur = run.startedAt && run.endedAt ? fmtTime((run.endedAt - run.startedAt) / 1000) : "";
      rows.push([
        day.date, run.brand, run.flavor, status,
        String(s.totalCases), String(run.actualCases ?? ""),
        String(run.wasteLbs ?? ""),
        run.startedAt ? fmtClock(run.startedAt) : "",
        run.endedAt ? fmtClock(run.endedAt) : "",
        dur,
        (run.notes ?? "").replace(/"/g, '""'),
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `production-run-${day.date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function printSummary() {
    window.print();
  }

  const runStatus: "pending" | "running" | "paused" | "ended" =
    currentRun?.endedAt ? "ended"
    : currentRun?.pausedAt ? "paused"
    : currentRun?.startedAt ? "running"
    : "pending";

  const liveFreezerMin = (() => {
    if (!currentRun?.startedAt) return 0;
    if (currentRun.endedAt) return Number(v.freezerTime);
    // When paused, freeze the timer at the moment of pause
    const refTime = currentRun.pausedAt ?? nowTime.getTime();
    const elapsed = (refTime - currentRun.startedAt) / 60000;
    return Math.min(elapsed, Number(v.freezerTime));
  })();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Reset all runs at midnight
  useEffect(() => {
    function msUntilMidnight() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      return midnight.getTime() - now.getTime();
    }
    let timeout: ReturnType<typeof setTimeout>;
    function scheduleReset() {
      timeout = setTimeout(() => {
        const fresh = freshDayState();
        setDayState(fresh);
        saveDayState(fresh);
        form.reset(DEFAULT_VALUES);
        scheduleReset();
      }, msUntilMidnight());
    }
    scheduleReset();
    return () => clearTimeout(timeout);
  }, []);

  const calc = useMemo(() => {
    const ppm =
      doughSubTab === "crusts"
        ? v.approxLineSpeed
        : v.crustsPerCycle * v.cycleSpeed * v.speedAdjustment;

    const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;

    const traysPerSkid =
      (v.casesPerSkid * v.pizzasPerCase) / perTray;
    const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : v.doughBatchYield;
    const traysPerBatch = v.doughBatchYield / perTray;
    const batchesPerSkid = traysPerSkid / traysPerBatch;

    // casesOnLine = ROUNDDOWN(ppm * freezerTime / pizzasPerCase, 0)
    // ppm already includes speedAdjustment — do not apply it a second time
    const freezerTime = liveFreezerMin;
    const casesOnLine =
      ppm > 0
        ? Math.floor((ppm * freezerTime) / v.pizzasPerCase)
        : 0;

    // Spreadsheet Dough!B4: casesNeeded - skidsCompleted*casesPerSkid - casesOnCurrentSkid - casesOnLine + casesPerLayer
    const casesLeftToRun =
      v.casesNeeded -
      v.skidsCompleted * v.casesPerSkid -
      v.casesOnCurrentSkid -
      casesOnLine +
      v.casesPerLayer;

    // For timing: same but without casesPerLayer (Timing sheet formula)
    const casesForTiming =
      v.casesNeeded -
      v.skidsCompleted * v.casesPerSkid -
      v.casesOnCurrentSkid -
      casesOnLine;

    const totalPizzasLeft = casesLeftToRun * v.pizzasPerCase;
    // Staged supply: trays/stacks already ready × units per tray, plus mixed batches ready
    const doughOnHand =
      v.traysOnLine * perTray +
      v.batchesReady * v.doughBatchYield;
    const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
    const batchesNeeded = doughDeficit / v.doughBatchYield;
    const traysNeeded = doughDeficit / perTray;
    // Net pizzas after deducting already-staged trays/stacks (same logic as doughDeficit)
    const pizzasNetOfStaged = Math.max(0, totalPizzasLeft - v.traysOnLine * perTray);
    const casesLeftToOpen = v.crustsPerCase > 0
      ? Math.ceil(pizzasNetOfStaged / v.crustsPerCase)
      : 0;
    const stacksNeededTotal = perTray > 0 ? Math.ceil(pizzasNetOfStaged / perTray) : 0;
    const buffer = Math.max(0, doughOnHand - totalPizzasLeft) / v.pizzasPerCase;
    const doughShortCases = doughDeficit / v.pizzasPerCase;
    const doughDepletionSec = ppm > 0 ? (doughOnHand / ppm) * 60 : 0;

    // Spreadsheet B9: roundup(casesPerSkid - casesOnLine, 0)
    const casesOnLastSkid = Math.ceil(
      Math.max(0, v.casesPerSkid - casesOnLine)
    );

    // Timing — spreadsheet D5 = (60/cycleSpeed)/speedAdjustment
    const timePressHzSec =
      ppm > 0 ? (60 / v.cycleSpeed) / v.speedAdjustment : 0;
    // Unified formula: perTray / ppm * 60 — equivalent to press-cycle formula in dough
    // mode, and correct for crust mode where ppm = approxLineSpeed directly
    const timePerTraySec =
      ppm > 0 ? (perTray / ppm) * 60 : 0;
    const timePerBatchSec =
      ppm > 0 ? (perBatch / ppm) * 60 : 0;
    const timePerSkidSec =
      ppm > 0 ? ((v.casesPerSkid * v.pizzasPerCase) / ppm) * 60 : 0;
    const timePerCaseSec =
      ppm > 0 ? (v.pizzasPerCase / ppm) * 60 : 0;
    const totalTimeSec =
      ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : 0;
    // Spreadsheet: includes batchesReady dough
    const doughMadeTimeSec =
      ppm > 0
        ? ((v.traysOnLine * perTray +
            v.batchesReady * v.doughBatchYield) /
            ppm) *
          60
        : 0;

    const rackTimes = [10, 12, 16, 18, 20, 22].map((n) => ({
      trays: n,
      sec: ppm > 0 ? (n * perTray * 60) / ppm : 0,
    }));

    // Frontline — batches = total_oz_needed / (batch_lbs * 16)
    // Spreadsheet adds casesPerLayer as a pizza buffer to sauce total only
    const totalPizzasRun = casesLeftToRun * v.pizzasPerCase;
    const totalPizzasForSauce = totalPizzasRun + v.casesPerLayer * v.pizzasPerCase;
    const sauceBatches =
      v.sauceBarrelLbs > 0
        ? (totalPizzasForSauce * v.sauceOzPerPizza) / (v.sauceBarrelLbs * 16)
        : 0;
    const app1Lbs = (totalPizzasRun * v.app1OzPerPizza) / 16 + 20;
    const app1IsMix = v.app1Type.trim().toLowerCase().includes("mix");
    const app1Batches = !app1IsMix && v.app1BatchLbs > 0 ? app1Lbs / v.app1BatchLbs : 0;
    const app2Lbs = (totalPizzasRun * v.app2OzPerPizza) / 16 + 20;
    const app2IsMix = v.app2Type.trim().toLowerCase().includes("mix");
    const app2Batches = !app2IsMix && v.app2BatchLbs > 0 ? app2Lbs / v.app2BatchLbs : 0;
    const app3Lbs = (totalPizzasRun * v.app3OzPerPizza) / 16 + 20;
    const app3IsMix = v.app3Type.trim().toLowerCase().includes("mix");
    const app3Batches = !app3IsMix && v.app3BatchLbs > 0 ? app3Lbs / v.app3BatchLbs : 0;
    const app4Lbs = (totalPizzasRun * v.app4OzPerPizza) / 16 + 20;
    const app4IsMix = v.app4Type.trim().toLowerCase().includes("mix");
    const app4Batches = !app4IsMix && v.app4BatchLbs > 0 ? app4Lbs / v.app4BatchLbs : 0;
    const pep1Lbs = (totalPizzasRun * v.pep1OzPerPizza) / 16 + v.pep1Sticks;
    const pep1Batches =
      !DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") && v.pep1BatchLbs > 0
        ? pep1Lbs / v.pep1BatchLbs
        : 0;
    const pep2Lbs = (totalPizzasRun * v.pep2OzPerPizza) / 16 + v.pep2Sticks;
    const pep2Batches =
      !DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") && v.pep2BatchLbs > 0
        ? pep2Lbs / v.pep2BatchLbs
        : 0;

    // ── Pace gauge ──────────────────────────────────────────────────────────
    // casesCompleted = skids done + cases on current skid
    const casesCompleted = v.skidsCompleted * v.casesPerSkid + v.casesOnCurrentSkid;
    // Adjusted remaining time: based on cases still left rather than full run
    const adjustedTimeSec = ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : totalTimeSec;
    // Pace: expected cases completed by now vs actual
    let paceStatus: "on-pace" | "ahead" | "behind" | null = null;
    let paceDelta = 0; // positive = ahead, negative = behind (in cases)
    if (currentRun?.startedAt && !currentRun?.endedAt && ppm > 0 && v.pizzasPerCase > 0) {
      const refTime = currentRun.pausedAt ?? Date.now();
      const elapsedMin = (refTime - currentRun.startedAt) / 60000;
      const expectedCases = Math.floor((ppm * elapsedMin) / v.pizzasPerCase);
      paceDelta = casesCompleted - expectedCases;
      paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
    }

    return {
      ppm,
      traysPerSkid,
      traysPerBatch,
      batchesPerSkid,
      casesOnLine,
      casesLeftToRun,
      casesLeftToOpen,
      stacksNeededTotal,
      casesForTiming,
      batchesNeeded,
      traysNeeded,
      buffer,
      doughShortCases,
      doughDepletionSec,
      casesOnLastSkid,
      timePressHzSec,
      timePerTraySec,
      timePerBatchSec,
      timePerSkidSec,
      timePerCaseSec,
      totalTimeSec,
      adjustedTimeSec,
      doughMadeTimeSec,
      rackTimes,
      sauceBatches,
      app1Lbs,
      app1Batches,
      app2Lbs,
      app2Batches,
      app3Lbs,
      app3Batches,
      app4Lbs,
      app4Batches,
      pep1Lbs,
      pep1Batches,
      pep2Lbs,
      pep2Batches,
      casesCompleted,
      paceStatus,
      paceDelta,
    };
  }, [v, liveFreezerMin, currentRun?.startedAt, currentRun?.pausedAt, currentRun?.endedAt, nowTime]);

  return (
    <div
      className="min-h-screen bg-background text-foreground p-4 md:p-6 font-sans"
      onTouchStart={e => { swipeTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={e => {
        if (!swipeTouchStart.current) return;
        const dx = e.changedTouches[0].clientX - swipeTouchStart.current.x;
        const dy = e.changedTouches[0].clientY - swipeTouchStart.current.y;
        swipeTouchStart.current = null;
        // Only register horizontal swipes (dx > 50, and more horizontal than vertical)
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // Don't swipe if user is interacting with an input
        if ((e.target as HTMLElement).closest("input, textarea, select, button")) return;
        if (dx < 0) { if (dayState.currentIndex < dayState.runs.length - 1) switchToRun(dayState.currentIndex + 1); }
        else { if (dayState.currentIndex > 0) switchToRun(dayState.currentIndex - 1); }
      }}
    >
      {/* ── Manage Lists Dialog ─────────────────────────────────────────── */}
      {showManageDialog && (() => {
        type Category = {
          key: string;
          label: string;
          items: string[];
          protected?: string[];
          onAdd: (v: string) => void;
          onRemove: (v: string) => void;
        };
        const categories: Category[] = [
          { key: "brands", label: "Brands", items: brands, onAdd: (v) => addBrand(v), onRemove: (v) => { const u = brands.filter(b => b !== v); setBrands(u); saveList(BRANDS_KEY, u); } },
          { key: "flavors", label: "Flavors", items: manageBrandFilter ? (brandFlavors[manageBrandFilter] ?? []) : [], onAdd: (v) => addFlavor(v, manageBrandFilter), onRemove: (v) => removeFlavor(v, manageBrandFilter) },
          { key: "ingredientTypes", label: "Applicator Ingredients", items: ingredientTypes, onAdd: addIngredientType, onRemove: removeIngredientType },
          { key: "pepTypes", label: "Pep Types", items: pepTypes, protected: [...DEFAULT_PEP_TYPES], onAdd: addPepType, onRemove: removePepType },
          { key: "cheeseIngredients", label: "Cheese Ingredients", items: cheeseIngredients, onAdd: addCheeseIngredient, onRemove: removeCheeseIngredient },
          { key: "mixIngredients", label: "Mix Ingredients", items: mixIngredients, onAdd: addMixIngredient, onRemove: removeMixIngredient },
          { key: "doughIngredients", label: "Dough Ingredients", items: doughIngredients, onAdd: addDoughIngredient, onRemove: removeDoughIngredient },
          { key: "doughRecipeNames", label: "Dough Recipe Names", items: doughRecipeNames, onAdd: addDoughRecipeName, onRemove: removeDoughRecipeName },
          { key: "frontlineIngredients", label: "Sauce Ingredients", items: frontlineIngredients, onAdd: addFrontlineIngredient, onRemove: removeFrontlineIngredient },
          { key: "frontlineRecipeNames", label: "Sauce Recipe Names", items: frontlineRecipeNames, onAdd: addFrontlineRecipeName, onRemove: removeFrontlineRecipeName },
          { key: "pin", label: "Change PIN", items: [], onAdd: () => {}, onRemove: () => {} },
        ];
        const cat = categories.find(c => c.key === manageCategory) ?? categories[0];
        const handleAdd = () => {
          const v = manageInput.trim();
          if (!v) return;
          cat.onAdd(v);
          setManageInput("");
        };
        const handlePinSave = () => {
          if (!newPin) { setPinChangeMsg("Enter a new PIN."); return; }
          if (newPin !== newPinConfirm) { setPinChangeMsg("PINs don't match."); return; }
          localStorage.setItem(SUPERVISOR_PIN_KEY, newPin);
          setNewPin(""); setNewPinConfirm("");
          setPinChangeMsg("PIN updated successfully.");
        };
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowManageDialog(false)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  <h2 className="font-bold text-base">Manage Lists & Settings</h2>
                </div>
                <button type="button" onClick={() => setShowManageDialog(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Category tabs */}
              <div className="flex gap-1 flex-wrap px-5 py-3 border-b border-border shrink-0">
                {categories.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => { setManageCategory(c.key); setManageInput(""); setPinChangeMsg(""); }}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${manageCategory === c.key ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {manageCategory === "flavors" && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Select brand to manage its flavors</label>
                    <select
                      value={manageBrandFilter}
                      onChange={e => { setManageBrandFilter(e.target.value); setManageInput(""); }}
                      className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">— choose a brand —</option>
                      {brands.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                )}

                {manageCategory === "pin" ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">Set a new supervisor PIN. It must match in both fields.</p>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">New PIN</label>
                      <input
                        type="password"
                        value={newPin}
                        onChange={e => { setNewPin(e.target.value); setPinChangeMsg(""); }}
                        placeholder="New PIN"
                        maxLength={8}
                        className="w-full font-mono text-center text-xl tracking-[0.3em] border border-input rounded-md h-11 bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Confirm PIN</label>
                      <input
                        type="password"
                        value={newPinConfirm}
                        onChange={e => { setNewPinConfirm(e.target.value); setPinChangeMsg(""); }}
                        placeholder="Confirm PIN"
                        maxLength={8}
                        onKeyDown={e => e.key === "Enter" && handlePinSave()}
                        className="w-full font-mono text-center text-xl tracking-[0.3em] border border-input rounded-md h-11 bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    {pinChangeMsg && (
                      <p className={`text-xs text-center font-medium ${pinChangeMsg.includes("success") ? "text-green-400" : "text-destructive"}`}>
                        {pinChangeMsg}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handlePinSave}
                      className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      Save PIN
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Add input — for flavors, require a brand to be selected */}
                    {(manageCategory !== "flavors" || manageBrandFilter) && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manageInput}
                        onChange={e => setManageInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleAdd()}
                        placeholder={manageCategory === "flavors" ? `Add flavor for ${manageBrandFilter}…` : `Add to ${cat.label}…`}
                        className="flex-1 border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={handleAdd}
                        disabled={!manageInput.trim()}
                        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                    )}

                    {/* Items list */}
                    {cat.items.length === 0 && (manageCategory !== "flavors" || manageBrandFilter) ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No items yet. Add one above.</p>
                    ) : cat.items.length === 0 && manageCategory === "flavors" && !manageBrandFilter ? null : (
                      <ul className="space-y-1">
                        {cat.items.map(item => {
                          const isProtected = cat.protected?.includes(item);
                          return (
                            <li key={item} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                              <span className="text-sm">{item}</span>
                              {isProtected ? (
                                <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">default</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => cat.onRemove(item)}
                                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                                  title={`Remove ${item}`}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── PIN Dialog ─────────────────────────────────────────────────── */}
      {showPinDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => { setShowPinDialog(false); setPinInput(""); setPinError(""); }}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-80 space-y-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center">
              <ShieldCheck className="w-9 h-9 mx-auto mb-2 text-primary" />
              <h2 className="font-bold text-lg">Supervisor Access</h2>
              <p className="text-xs text-muted-foreground mt-1">Enter the supervisor PIN to unlock all settings</p>
            </div>
            <input
              type="password"
              value={pinInput}
              onChange={e => { setPinInput(e.target.value); setPinError(""); }}
              onKeyDown={e => e.key === "Enter" && checkPin()}
              className="w-full text-center font-mono text-2xl tracking-[0.4em] border border-input rounded-md h-12 bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="••••"
              autoFocus
              maxLength={8}
            />
            {pinError && <p className="text-xs text-destructive text-center font-medium">{pinError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowPinDialog(false); setPinInput(""); setPinError(""); }}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
              >Cancel</button>
              <button
                type="button"
                onClick={checkPin}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >Unlock</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-5">
        {/* ─── RUN SELECTOR ─── */}
        <div className="print:hidden flex justify-center">
          {/* Current run — brand + flavor pickers */}
          <div className="flex flex-col items-center gap-2 px-4 py-2 rounded-lg bg-primary/15 border border-primary/30 w-full max-w-lg">
            <div className="text-[9px] uppercase tracking-widest text-primary/70 font-semibold">Current Run</div>
            <div className="flex items-center gap-2">

              {/* Brand picker */}
              <div className="relative">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-0.5 text-center">Brand</div>
                <div className="relative">
                  <input
                    value={showBrandDrop ? brandInput : (currentRun?.brand ?? "")}
                    placeholder="Brand…"
                    className="w-28 bg-background/60 border border-border/60 rounded px-2 py-1 text-sm font-semibold text-center outline-none focus:border-primary cursor-pointer"
                    readOnly={!showBrandDrop}
                    onClick={() => {
                      setBrandInput(currentRun?.brand ?? "");
                      setShowBrandDrop(true);
                      setShowFlavorDrop(false);
                    }}
                    onChange={(e) => setBrandInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const b = addBrand(brandInput);
                        setRunBrandFlavor(b, currentRun?.flavor ?? "");
                        setShowBrandDrop(false);
                      }
                      if (e.key === "Escape") setShowBrandDrop(false);
                    }}
                    onBlur={() => setTimeout(() => { if (!confirmDeleteBrandRef.current) setShowBrandDrop(false); }, 150)}
                  />
                  {showBrandDrop && (
                    <div className="absolute z-50 top-full mt-1 left-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto">
                      {brands
                        .filter((b) => b.toLowerCase().includes(brandInput.toLowerCase()))
                        .map((b) =>
                          confirmDeleteBrand === b ? (
                            <div key={b} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                              <span className="text-[10px] text-destructive font-semibold truncate">Remove "{b}"?</span>
                              <span className="flex gap-1 shrink-0">
                                <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { removeBrand(b); confirmDeleteBrandRef.current = null; setConfirmDeleteBrand(null); setShowBrandDrop(false); }}>Yes</button>
                                <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteBrandRef.current = null; setConfirmDeleteBrand(null); }}>No</button>
                              </span>
                            </div>
                          ) : (
                            <div key={b} className="flex items-center">
                              <button
                                type="button"
                                className={`flex-1 text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.brand === b ? "text-primary font-semibold" : ""}`}
                                onMouseDown={() => { setRunBrandFlavor(b, currentRun?.flavor ?? ""); setShowBrandDrop(false); }}
                              >
                                {b}
                              </button>
                              <button
                                type="button"
                                tabIndex={-1}
                                className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                                onMouseDown={e => { e.stopPropagation(); confirmDeleteBrandRef.current = b; setConfirmDeleteBrand(b); }}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )
                        )}
                      {brandInput.trim() && !brands.includes(brandInput.trim()) && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm text-primary hover:bg-muted transition-colors flex items-center gap-1"
                          onMouseDown={() => {
                            const b = addBrand(brandInput);
                            setRunBrandFlavor(b, currentRun?.flavor ?? "");
                            setShowBrandDrop(false);
                          }}
                        >
                          <Plus className="w-3 h-3" /> Add "{brandInput.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-muted-foreground/40 text-lg font-light">–</div>

              {/* Flavor picker */}
              <div className="relative">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-0.5 text-center">Flavor</div>
                <div className="relative">
                  <input
                    value={showFlavorDrop ? flavorInput : (currentRun?.flavor ?? "")}
                    placeholder="Flavor…"
                    className="w-28 bg-background/60 border border-border/60 rounded px-2 py-1 text-sm font-semibold text-center outline-none focus:border-primary cursor-pointer"
                    readOnly={!showFlavorDrop}
                    onClick={() => {
                      setFlavorInput(currentRun?.flavor ?? "");
                      setShowFlavorDrop(true);
                      setShowBrandDrop(false);
                    }}
                    onChange={(e) => setFlavorInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const f = addFlavor(flavorInput);
                        setRunBrandFlavor(currentRun?.brand ?? "", f);
                        setShowFlavorDrop(false);
                      }
                      if (e.key === "Escape") setShowFlavorDrop(false);
                    }}
                    onBlur={() => setTimeout(() => { if (!confirmDeleteFlavorRef.current) setShowFlavorDrop(false); }, 150)}
                  />
                  {showFlavorDrop && (
                    <div className="absolute z-50 top-full mt-1 left-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto">
                      {!(currentRun?.brand) && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Pick a brand first</p>
                      )}
                      {(brandFlavors[currentRun?.brand ?? ""] ?? [])
                        .filter((f) => f.toLowerCase().includes(flavorInput.toLowerCase()))
                        .map((f) =>
                          confirmDeleteFlavor === f ? (
                            <div key={f} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                              <span className="text-[10px] text-destructive font-semibold truncate">Remove "{f}"?</span>
                              <span className="flex gap-1 shrink-0">
                                <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { removeFlavor(f); confirmDeleteFlavorRef.current = null; setConfirmDeleteFlavor(null); setShowFlavorDrop(false); }}>Yes</button>
                                <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteFlavorRef.current = null; setConfirmDeleteFlavor(null); }}>No</button>
                              </span>
                            </div>
                          ) : (
                            <div key={f} className="flex items-center">
                              <button
                                type="button"
                                className={`flex-1 text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.flavor === f ? "text-primary font-semibold" : ""}`}
                                onMouseDown={() => { setRunBrandFlavor(currentRun?.brand ?? "", f); setShowFlavorDrop(false); }}
                              >
                                {f}
                              </button>
                              <button
                                type="button"
                                tabIndex={-1}
                                className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                                onMouseDown={e => { e.stopPropagation(); confirmDeleteFlavorRef.current = f; setConfirmDeleteFlavor(f); }}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )
                        )}
                      {currentRun?.brand && flavorInput.trim() && !(brandFlavors[currentRun.brand] ?? []).includes(flavorInput.trim()) && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm text-primary hover:bg-muted transition-colors flex items-center gap-1"
                          onMouseDown={() => {
                            const f = addFlavor(flavorInput);
                            setRunBrandFlavor(currentRun?.brand ?? "", f);
                            setShowFlavorDrop(false);
                          }}
                        >
                          <Plus className="w-3 h-3" /> Add "{flavorInput.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Run status + Start/End buttons */}
            <div className="flex items-center gap-2">
              {runStatus === "pending" && (
                <button
                  type="button"
                  onClick={startRun}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors"
                >
                  <Play className="w-3 h-3 fill-current" /> Start Run
                </button>
              )}
              {runStatus === "running" && (
                <>
                  <span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse shrink-0" />
                    Running
                  </span>
                  <button
                    type="button"
                    onClick={pauseRun}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
                  >
                    <Pause className="w-3 h-3 fill-current" /> Pause
                  </button>
                  <button
                    type="button"
                    onClick={endRun}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-700 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
                  >
                    <Square className="w-3 h-3 fill-current" /> Stop Run
                  </button>
                </>
              )}
              {runStatus === "paused" && (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                    Paused
                  </span>
                  {resumeDialog ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground font-medium">Freezer empty?</span>
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors"
                        onClick={() => { resumeRun(true); setResumeDialog(false); }}
                      >Yes</button>
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded bg-muted hover:bg-muted/70 text-muted-foreground text-xs font-semibold transition-colors"
                        onClick={() => { resumeRun(false); setResumeDialog(false); }}
                      >No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setResumeDialog(true)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" /> Resume
                    </button>
                  )}
                </div>
              )}
              {runStatus === "ended" && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                  Ended
                </span>
              )}
            </div>

            {/* Estimated time to finish — shown while running or paused */}
            {(runStatus === "running" || runStatus === "paused") && calc.totalTimeSec > 0 && (() => {
              const projectedFinish = Date.now() + calc.totalTimeSec * 1000;
              const driftMs = initialFinishTimestampRef.current > 0
                ? projectedFinish - initialFinishTimestampRef.current
                : 0;
              const driftSec = driftMs / 1000;
              const showDrift = Math.abs(driftSec) >= 30;
              const ahead = driftSec < 0;
              return (
                <div className="flex flex-col items-center gap-1 py-1.5">
                  <div className="flex items-center gap-2">
                    <Timer className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">Est. finish in</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">{fmtTime(calc.adjustedTimeSec)}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</span>
                  </div>
                  {showDrift && (
                    <div className={`flex items-center gap-1.5 text-xs font-semibold ${ahead ? "text-emerald-400" : "text-amber-400"}`}>
                      <span>{ahead ? "▲" : "▼"}</span>
                      <span>{ahead ? `${fmtTime(Math.abs(driftSec))} ahead of original estimate` : `${fmtTime(Math.abs(driftSec))} behind original estimate`}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Pace gauge */}
            {calc.paceStatus !== null && (
              <div className={`flex items-center justify-center gap-2 py-1.5 px-4 rounded-lg text-xs font-semibold ${
                calc.paceStatus === "on-pace" ? "bg-emerald-950/40 border border-emerald-700/30 text-emerald-400"
                : calc.paceStatus === "ahead" ? "bg-emerald-950/40 border border-emerald-700/30 text-emerald-400"
                : "bg-amber-950/40 border border-amber-700/30 text-amber-400"
              }`}>
                <span>{calc.paceStatus === "on-pace" ? "✓ On Pace" : calc.paceStatus === "ahead" ? `▲ ${calc.paceDelta} cases ahead` : `▼ ${Math.abs(calc.paceDelta)} cases behind`}</span>
              </div>
            )}

            {/* Navigation row: Previous · count · New Run · Upcoming */}
            <div className="flex items-center justify-between w-full gap-1 pt-1 border-t border-primary/20">
              {/* Previous */}
              {dayState.currentIndex > 0 ? (
                <button
                  type="button"
                  onClick={() => switchToRun(dayState.currentIndex - 1)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                  <div className="text-left min-w-0">
                    <div className="text-[8px] uppercase tracking-widest opacity-50 font-semibold leading-none mb-0.5">Prev</div>
                    <div className="font-medium text-xs truncate max-w-[90px]">{runLabel(dayState.runs[dayState.currentIndex - 1])}</div>
                  </div>
                </button>
              ) : (
                <div className="w-16" />
              )}

              {/* Upcoming */}
              {dayState.currentIndex < dayState.runs.length - 1 ? (
                <button
                  type="button"
                  onClick={() => switchToRun(dayState.currentIndex + 1)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0"
                >
                  <div className="text-right min-w-0">
                    <div className="text-[8px] uppercase tracking-widest opacity-50 font-semibold leading-none mb-0.5">Next</div>
                    <div className="font-medium text-xs truncate max-w-[90px]">{runLabel(dayState.runs[dayState.currentIndex + 1])}</div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              ) : (
                <div className="w-16" />
              )}

              {/* Count + Run actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground tabular-nums">{dayState.runs.length}/{MAX_RUNS}</span>
                {/* Remove run — only for upcoming (pending) runs when more than one exists, supervisors only */}
                {isSupervisor && !currentRun?.startedAt && !currentRun?.endedAt && dayState.runs.length > 1 && (
                  confirmRemoveRun ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-destructive font-semibold">Remove?</span>
                      <button
                        type="button"
                        className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors"
                        onClick={removeRun}
                      >Yes</button>
                      <button
                        type="button"
                        className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors"
                        onClick={() => setConfirmRemoveRun(false)}
                      >No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveRun(true)}
                      className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove this run"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyRun}
                  disabled={dayState.runs.length >= MAX_RUNS}
                  title="Duplicate this run's settings into a new run"
                  className="h-6 px-2 gap-1 text-xs"
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRun}
                  disabled={dayState.runs.length >= MAX_RUNS}
                  className="h-6 px-2 gap-1 text-xs"
                >
                  <Plus className="w-3 h-3" />
                  New Run
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Header */}
        <header className="flex items-center justify-between print:mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-primary text-primary-foreground flex items-center justify-center print:hidden">
              <Factory className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Production Run Calculator
              </h1>
              <p className="text-xs text-muted-foreground">
                Pizza line planning & schedule estimation
              </p>
            </div>
          </div>
          <div className="print:hidden flex items-center gap-2">
            {/* Auto-save badge */}
            <span className={`text-[10px] font-semibold flex items-center gap-1 transition-opacity duration-500 ${savedFlash ? "opacity-100 text-emerald-400" : "opacity-0"}`}>
              <Check className="w-3 h-3" /> Saved
            </span>
            {/* Manage Lists button — supervisor only */}
            {isSupervisor && (
              <button
                type="button"
                onClick={() => { setManageInput(""); setPinChangeMsg(""); setShowManageDialog(true); }}
                title="Manage lists & settings"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-border text-muted-foreground bg-muted/30 hover:bg-muted/60 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                Manage
              </button>
            )}
            {/* Role badge */}
            <button
              type="button"
              onClick={() => {
                if (isSupervisor) {
                  setRole("operator");
                } else {
                  setPinInput("");
                  setPinError("");
                  setShowPinDialog(true);
                }
              }}
              title={isSupervisor ? "Click to exit supervisor mode" : "Click to enter supervisor mode"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                isSupervisor
                  ? "border-primary/40 text-primary bg-primary/10 hover:bg-primary/20"
                  : "border-border text-muted-foreground bg-muted/30 hover:bg-muted/60"
              }`}
            >
              {isSupervisor ? <ShieldCheck className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {isSupervisor ? "Supervisor" : "Operator"}
            </button>
          </div>
        </header>

        <Form {...form}>
          <form>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full print:hidden">
              <TabsList className="grid grid-cols-5 w-full mb-4 print:hidden">
                <TabsTrigger value="info" data-testid="tab-info">
                  <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
                  Enter Info
                </TabsTrigger>
                <TabsTrigger value="dough" data-testid="tab-dough">
                  <Layers className="w-3.5 h-3.5 mr-1.5" />
                  Dough/Crusts
                </TabsTrigger>
                <TabsTrigger value="timing" data-testid="tab-timing">
                  <Clock className="w-3.5 h-3.5 mr-1.5" />
                  Timing
                </TabsTrigger>
                <TabsTrigger value="frontline" data-testid="tab-frontline">
                  <Droplets className="w-3.5 h-3.5 mr-1.5" />
                  Frontline
                </TabsTrigger>
                <TabsTrigger value="summary" data-testid="tab-summary">
                  <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
                  Summary
                </TabsTrigger>
              </TabsList>

              {/* ─── ENTER INFO ─── */}
              <TabsContent value="info">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Card className={`bg-card/50 border-border/50 shadow-md${!isSupervisor ? " opacity-60" : ""}`}>
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                        Line Settings
                        {!isSupervisor && <Lock className="w-3.5 h-3.5 text-muted-foreground/50" />}
                      </CardTitle>
                    </CardHeader>
                    <fieldset disabled={!isSupervisor} className="contents">
                    <CardContent className="px-5 pb-5 space-y-3">
                      <NumField
                        control={form.control}
                        name="casesNeeded"
                        label="Cases Needed"
                      />
                      {doughSubTab === "crusts" ? (
                        <NumField
                          control={form.control}
                          name="approxLineSpeed"
                          label="Approximate Line Speed (ppm)"
                          step="0.1"
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <NumField
                            control={form.control}
                            name="crustsPerCycle"
                            label="Crusts Per Cycle"
                            step="1"
                          />
                          <NumField
                            control={form.control}
                            name="cycleSpeed"
                            label="Cycle Speed (cyc/min)"
                          />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="speedAdjustment"
                          label="Speed Adjustment"
                        />
                        <div>
                          <NumField
                            control={form.control}
                            name="freezerTime"
                            label="Freezer Time (min)"
                          />
                          {runStatus === "running" && (() => {
                            const totalSecs = Number(v.freezerTime) * 60;
                            const elapsedSecs = liveFreezerMin * 60;
                            const remainSecs = Math.max(0, totalSecs - elapsedSecs);
                            const pct = totalSecs > 0 ? Math.min(elapsedSecs / totalSecs, 1) : 0;
                            const mm = Math.floor(remainSecs / 60);
                            const ss = Math.floor(remainSecs % 60);
                            const done = remainSecs === 0;
                            return (
                              <div className="mt-1.5 space-y-1">
                                <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-1000 ${done ? "bg-green-500" : "bg-primary"}`}
                                    style={{ width: `${pct * 100}%` }}
                                  />
                                </div>
                                <p className={`text-[10px] font-mono font-semibold text-right ${done ? "text-green-400" : "text-muted-foreground"}`}>
                                  {done
                                    ? "✓ Freezer time complete"
                                    : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")} remaining`}
                                </p>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      <Separator className="opacity-30" />
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="pizzasPerCase"
                          label="Pizzas Per Case"
                          step="1"
                        />
                        <NumField
                          control={form.control}
                          name="casesPerSkid"
                          label="Cases Per Skid"
                          step="1"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="casesPerLayer"
                          label="Extra Case Buffer"
                          step="1"
                        />
                        {doughSubTab === "crusts" ? (
                          <NumField
                            control={form.control}
                            name="crustsPerStack"
                            label="Crusts Per Stack"
                            step="1"
                          />
                        ) : (
                          <NumField
                            control={form.control}
                            name="doughballsPerTray"
                            label="Doughballs Per Tray"
                            step="1"
                          />
                        )}
                      </div>
                      {doughSubTab === "crusts" ? (
                        <NumField
                          control={form.control}
                          name="crustsPerCase"
                          label="Crusts Per Case"
                          step="1"
                        />
                      ) : (
                        <NumField
                          control={form.control}
                          name="doughBatchYield"
                          label="Dough Batch Yield (doughballs)"
                          step="1"
                        />
                      )}
                    </CardContent>
                    </fieldset>
                  </Card>

                  <Card className="bg-card/50 border-border/50 shadow-md">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Current Progress
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 space-y-3">
                      <StepperField
                        control={form.control}
                        name="skidsCompleted"
                        label="Total Skids Completed"
                      />
                      <StepperField
                        control={form.control}
                        name="casesOnCurrentSkid"
                        label="Cases on Current Skid"
                      />
                      <StepperField
                        control={form.control}
                        name="traysOnLine"
                        label={doughSubTab === "crusts" ? "Total Stacks Ready" : "Total Trays on Line"}
                      />
                      {doughSubTab !== "crusts" && (
                        <StepperField
                          control={form.control}
                          name="batchesReady"
                          label="Batches of Dough Ready"
                        />
                      )}
                    </CardContent>

                    {/* Quick summary */}
                    <div className="mx-5 mb-5 rounded-md bg-primary/10 border border-primary/20 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
                        Quick Summary
                      </p>
                      <StatRow
                        label="Cases Left to Run"
                        value={fmtNum(calc.casesLeftToRun, 0)}
                        testId="output-cases-left"
                        highlight
                      />
                      <StatRow
                        label="Time Left"
                        value={fmtTime(calc.totalTimeSec)}
                        testId="output-time-left"
                        highlight
                      />
                      <StatRow
                        label="Pizzas / Min"
                        value={fmtNum(calc.ppm, 1)}
                        testId="output-ppm"
                      />
                    </div>
                  </Card>
                </div>
              </TabsContent>

              {/* ─── DOUGH ─── */}
              <TabsContent value="dough">
                {!isSupervisor && (
                  <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    Supervisor access required to edit these settings
                  </div>
                )}
                <fieldset disabled={!isSupervisor} className={!isSupervisor ? "opacity-60 pointer-events-none" : ""}>
                {/* Sub-toggle */}
                <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit mb-5">
                  <button
                    type="button"
                    onClick={() => {
                      setDoughSubTab("dough");
                      const newRuns = dayState.runs.map((r, i) => i === dayState.currentIndex ? { ...r, subTab: "dough" as const } : r);
                      const newDs = { ...dayState, runs: newRuns };
                      setDayState(newDs);
                      saveDayState(newDs);
                    }}
                    className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${doughSubTab === "dough" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Dough
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDoughSubTab("crusts");
                      const newRuns = dayState.runs.map((r, i) => i === dayState.currentIndex ? { ...r, subTab: "crusts" as const } : r);
                      const newDs = { ...dayState, runs: newRuns };
                      setDayState(newDs);
                      saveDayState(newDs);
                    }}
                    className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${doughSubTab === "crusts" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Crust
                  </button>
                </div>

                {/* ── Crust run ── */}
                {doughSubTab === "crusts" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                      <div className="h-1 bg-sky-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          Run Details
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        <StatRow label="Cases Left to Run" value={fmtNum(calc.casesLeftToRun, 0)} highlight />
                        <StatRow label="Total Time Left" value={fmtTime(calc.totalTimeSec)} highlight />
                        <Separator className="my-3 opacity-30" />
                        <StatRow label="Cases Left to Open" value={fmtNum(calc.casesLeftToOpen, 0)} />
                        <StatRow label="Stacks Needed" value={fmtNum(calc.stacksNeededTotal, 0)} />
                        <Separator className="my-3 opacity-30" />
                        <StatRow label="Approx. Cases on Line" value={fmtNum(calc.casesOnLine, 0)} />
                      </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                      <div className="h-1 bg-sky-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          Crust Output
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        <div className="mb-2">
                          <p className="text-5xl font-mono font-bold text-sky-400" data-testid="output-ppm-crust">
                            {fmtNum(calc.ppm, 1)}
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">Pizzas per minute</p>
                        </div>
                        <Separator className="my-4 opacity-30" />
                        <StatRow label="Time Per Stack" value={fmtTime(calc.timePerTraySec)} />
                        <StatRow label="Time Per Skid" value={fmtTime(calc.timePerSkidSec)} />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* ── Dough run ── */}
                {doughSubTab === "dough" && (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                    <div className="h-1 bg-primary w-full" />
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        What You Need Now
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5">
                      <div className="mb-2">
                        <p
                          className="text-5xl font-mono font-bold text-primary"
                          data-testid="output-batches-needed"
                        >
                          {fmtNum(calc.batchesNeeded, 2)}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Batches to mix
                        </p>
                      </div>
                      <Separator className="my-4 opacity-30" />
                      <div>
                        <p
                          className="text-3xl font-mono font-bold"
                          data-testid="output-trays-needed"
                        >
                          {fmtNum(calc.traysNeeded, 0)}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Trays needed
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/50 shadow-md">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Run Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5">
                      <StatRow
                        label="Cases Left to Run"
                        value={fmtNum(calc.casesLeftToRun, 0)}
                        testId="output-dough-cases-left"
                      />
                      <StatRow
                        label="Approx. Cases on Line"
                        value={fmtNum(calc.casesOnLine, 0)}
                        testId="output-cases-on-line"
                      />
                      <div className="flex items-center justify-between py-1.5" data-testid="output-dough-status">
                        <span className="text-sm text-muted-foreground">Dough Status</span>
                        {calc.doughShortCases > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-400">
                            <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                            SHORT {fmtNum(calc.doughShortCases, 1)} cases
                          </span>
                        ) : calc.buffer > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                            <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                            +{fmtNum(calc.buffer, 1)} cases ahead
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                            Balanced
                          </span>
                        )}
                      </div>
                      <StatRow
                        label="Cases on Last Skid"
                        value={fmtNum(calc.casesOnLastSkid, 0)}
                        testId="output-last-skid-cases"
                      />
                      <Separator className="my-3 opacity-30" />
                      <StatRow
                        label="Trays Per Skid"
                        value={fmtNum(calc.traysPerSkid, 2)}
                        testId="output-trays-per-skid"
                      />
                      <StatRow
                        label="Trays Per Batch"
                        value={fmtNum(calc.traysPerBatch, 2)}
                        testId="output-trays-per-batch"
                      />
                      <StatRow
                        label="Batches Per Skid"
                        value={fmtNum(calc.batchesPerSkid, 2)}
                        testId="output-batches-per-skid"
                      />
                    </CardContent>
                  </Card>
                </div>
                  </>
                )}
                </fieldset>

                {/* Run to Time card — available to all roles */}
                {doughSubTab === "dough" && (() => {
                  const target = new Date(nowTime);
                  const [hrs, mins] = runToTime.split(":").map(Number);
                  target.setHours(hrs, mins, 0, 0);
                  if (target <= nowTime) target.setDate(target.getDate() + 1);
                  const minutesAvailable = Math.max(0, (target.getTime() - nowTime.getTime()) / 60000);
                  const batchMixMinutes = calc.timePerBatchSec / 60;
                  const batchesPossible = batchMixMinutes > 0 ? Math.floor(minutesAvailable / batchMixMinutes) : 0;
                  const to12hr = (hhmm: string) => {
                    const [h, m] = hhmm.split(":").map(Number);
                    const ampm = h >= 12 ? "PM" : "AM";
                    const h12 = h % 12 || 12;
                    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                  };
                  const nowLabel = to12hr(
                    `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`
                  );
                  return (
                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mt-0">
                      <div className="h-1 bg-amber-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" />
                          Run to Time
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Current Time</label>
                            <p className="font-mono text-lg font-bold">{nowLabel}</p>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Run Until</label>
                            <input
                              type="time"
                              value={runToTime}
                              onChange={(e) => setRunToTime(e.target.value)}
                              className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                            <p className="text-xs text-muted-foreground mt-1 font-mono">{to12hr(runToTime)}</p>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Min / Batch</label>
                            <p className="font-mono text-lg font-bold">{fmtNum(batchMixMinutes, 1)}</p>
                          </div>
                        </div>
                        <Separator className="mb-4 opacity-30" />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold text-amber-400">
                              {Math.floor(minutesAvailable / 60) > 0 && `${Math.floor(minutesAvailable / 60)}h `}{Math.round(minutesAvailable % 60)}m
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Time available</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold text-primary">{batchesPossible}</p>
                            <p className="text-xs text-muted-foreground mt-1">Batches possible</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                <fieldset disabled={!isSupervisor} className={!isSupervisor ? "opacity-60 pointer-events-none" : ""}>
                {doughSubTab === "dough" && (
                <DoughRecipeCard
                  batchesNeeded={calc.batchesNeeded}
                  fields={doughFields}
                  recipe={v.doughRecipe ?? []}
                  register={form.register}
                  targetWeight={Number(v.targetDoughballWeight ?? 0)}
                  doughBatchYield={Number(v.doughBatchYield)}
                  ingredientOptions={doughIngredients}
                  onAddIngredient={addDoughIngredient}
                  onRemoveIngredient={removeDoughIngredient}
                  onSetIngredient={(idx, val) => form.setValue(`doughRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                  onAppend={() => appendDough({ ingredient: "", lbs: 0 })}
                  onRemove={removeDough}
                  onTargetWeightChange={val => form.setValue("targetDoughballWeight", val, { shouldDirty: true })}
                  recipeName={v.doughRecipeName ?? ""}
                  recipeNameOptions={doughRecipeNames}
                  onAddRecipeName={addDoughRecipeName}
                  onRemoveRecipeName={removeDoughRecipeName}
                  onRecipeNameChange={val => form.setValue("doughRecipeName", val, { shouldDirty: true })}
                />
                )}
                </fieldset>
              </TabsContent>

              {/* ─── TIMING ─── */}
              <TabsContent value="timing">
                {!isSupervisor && (
                  <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    Supervisor access required to edit these settings
                  </div>
                )}
                <fieldset disabled={!isSupervisor} className={!isSupervisor ? "opacity-60 pointer-events-none" : ""}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-5">
                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                      <div className="h-1 bg-primary w-full" />
                      <CardContent className="p-5">
                        <div className="mb-2">
                          <p
                            className="text-4xl font-mono font-bold text-primary"
                            data-testid="output-total-time-left"
                          >
                            {fmtTime(calc.totalTimeSec)}
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Total time left for run
                          </p>
                        </div>
                        <Separator className="my-4 opacity-30" />
                        <StatRow
                          label={doughSubTab === "crusts" ? "Time for Crusts to Clear" : "Time for Dough to Clear"}
                          value={fmtTime(calc.doughMadeTimeSec)}
                          testId="output-dough-time"
                        />
                        <div className="flex items-center justify-between py-1.5" data-testid="output-dough-depletion">
                          <span className="text-sm text-muted-foreground">{doughSubTab === "crusts" ? "Crusts Run Out In" : "Dough Runs Out In"}</span>
                          {calc.doughDepletionSec <= 0 ? (
                            <span className="text-sm font-semibold text-muted-foreground">—</span>
                          ) : calc.doughDepletionSec >= calc.totalTimeSec ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                              <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                              {fmtTime(calc.doughDepletionSec)} (run covered)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-400">
                              <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                              {fmtTime(calc.doughDepletionSec)} (short!)
                            </span>
                          )}
                        </div>
                        {doughSubTab !== "crusts" && (
                          <StatRow
                            label="Pizzas Per Minute"
                            value={fmtNum(calc.ppm, 1)}
                            testId="output-timing-ppm"
                          />
                        )}
                        {doughSubTab !== "crusts" && (
                          <StatRow
                            label={
                              runStatus === "running"
                                ? `Freezer Time (${fmtNum(liveFreezerMin, 1)} / ${fmtNum(Number(v.freezerTime), 1)} min)`
                                : "Freezer Time"
                            }
                            value={fmtNum(liveFreezerMin, 1) + " min"}
                            testId="output-freezer-time"
                          />
                        )}
                      </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border/50 shadow-md">
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          Per Unit Times
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        {doughSubTab !== "crusts" && (
                          <StatRow
                            label="Time Per Press Cycle"
                            value={fmtNum(calc.timePressHzSec, 2) + "s"}
                            testId="output-time-per-cycle"
                          />
                        )}
                        <StatRow
                          label={doughSubTab === "crusts" ? "Time Per Stack" : "Time Per Tray"}
                          value={fmtTime(calc.timePerTraySec)}
                          testId="output-time-per-tray"
                        />
                        {doughSubTab !== "crusts" && (
                          <StatRow
                            label="Time Per Batch"
                            value={fmtTime(calc.timePerBatchSec)}
                            testId="output-time-per-batch"
                          />
                        )}
                        {doughSubTab === "crusts" && (
                          <StatRow
                            label="Time Per Case"
                            value={fmtTime(calc.timePerCaseSec)}
                            testId="output-time-per-case"
                          />
                        )}
                        <StatRow
                          label="Time Per Skid"
                          value={fmtTime(calc.timePerSkidSec)}
                          testId="output-time-per-skid"
                          highlight
                        />
                      </CardContent>
                    </Card>
                  </div>

                  {doughSubTab !== "crusts" && (
                    <Card className="bg-card/50 border-border/50 shadow-md">
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          Rack Times
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        {calc.rackTimes.map(({ trays, sec }) => (
                          <StatRow
                            key={trays}
                            label={`${trays}-Tray Rack`}
                            value={fmtTime(sec)}
                            testId={`output-rack-${trays}`}
                          />
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
                </fieldset>
              </TabsContent>

              {/* ─── FRONTLINE ─── */}
              <TabsContent value="frontline">
                {!isSupervisor && (
                  <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    Supervisor access required to edit these settings
                  </div>
                )}
                <fieldset disabled={!isSupervisor} className={!isSupervisor ? "opacity-60 pointer-events-none" : ""}>
                <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Card className="bg-card/50 border-border/50 shadow-md">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Sauce & Applicator Weights
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 space-y-4">
                      <TypeDropdown
                        label="Sauce"
                        value={v.frontlineRecipeName}
                        onChange={val => { form.setValue("frontlineRecipeName", val, { shouldDirty: true }); if (!val) { form.setValue("sauceOzPerPizza", 0, { shouldDirty: true }); form.setValue("sauceBarrelLbs", 0, { shouldDirty: true }); } }}
                        options={frontlineRecipeNames}
                        onAddOption={addFrontlineRecipeName}
                        onRemoveOption={removeFrontlineRecipeName}
                        allowClear
                      />
                      {v.frontlineRecipeName.trim() && (
                        <div className="grid grid-cols-2 gap-3">
                          <NumField
                            control={form.control}
                            name="sauceOzPerPizza"
                            label="Oz Per Pizza"
                          />
                          <NumField
                            control={form.control}
                            name="sauceBarrelLbs"
                            label="Barrel Weight (lbs)"
                          />
                        </div>
                      )}

                      <TypeDropdown
                        label="Applicator 1"
                        value={v.app1Type}
                        onChange={val => { form.setValue("app1Type", val, { shouldDirty: true }); if (!val) { form.setValue("app1OzPerPizza", 0, { shouldDirty: true }); form.setValue("app1BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app1Type.trim() && (
                        <div className={v.app1Type.trim().toLowerCase().includes("mix") ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                          <NumField control={form.control} name="app1OzPerPizza" label="Oz Per Pizza" />
                          {!v.app1Type.trim().toLowerCase().includes("mix") && (
                            <NumField control={form.control} name="app1BatchLbs" label="Batch Weight (lbs)" />
                          )}
                        </div>
                      )}

                      <TypeDropdown
                        label="Applicator 2"
                        value={v.app2Type}
                        onChange={val => { form.setValue("app2Type", val, { shouldDirty: true }); if (!val) { form.setValue("app2OzPerPizza", 0, { shouldDirty: true }); form.setValue("app2BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app2Type.trim() && (
                        <div className={v.app2Type.trim().toLowerCase().includes("mix") ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                          <NumField control={form.control} name="app2OzPerPizza" label="Oz Per Pizza" />
                          {!v.app2Type.trim().toLowerCase().includes("mix") && (
                            <NumField control={form.control} name="app2BatchLbs" label="Batch Weight (lbs)" />
                          )}
                        </div>
                      )}

                      <TypeDropdown
                        label="Applicator 3"
                        value={v.app3Type}
                        onChange={val => { form.setValue("app3Type", val, { shouldDirty: true }); if (!val) { form.setValue("app3OzPerPizza", 0, { shouldDirty: true }); form.setValue("app3BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app3Type.trim() && (
                        <div className={v.app3Type.trim().toLowerCase().includes("mix") ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                          <NumField control={form.control} name="app3OzPerPizza" label="Oz Per Pizza" />
                          {!v.app3Type.trim().toLowerCase().includes("mix") && (
                            <NumField control={form.control} name="app3BatchLbs" label="Batch Weight (lbs)" />
                          )}
                        </div>
                      )}

                      <TypeDropdown
                        label="Applicator 4"
                        value={v.app4Type}
                        onChange={val => { form.setValue("app4Type", val, { shouldDirty: true }); if (!val) { form.setValue("app4OzPerPizza", 0, { shouldDirty: true }); form.setValue("app4BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app4Type.trim() && (
                        <div className={v.app4Type.trim().toLowerCase().includes("mix") ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                          <NumField control={form.control} name="app4OzPerPizza" label="Oz Per Pizza" />
                          {!v.app4Type.trim().toLowerCase().includes("mix") && (
                            <NumField control={form.control} name="app4BatchLbs" label="Batch Weight (lbs)" />
                          )}
                        </div>
                      )}

                      <TypeDropdown
                        label="Pep Applicator 1"
                        value={v.pep1Type}
                        onChange={val => { form.setValue("pep1Type", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep1BatchLbs", 0, { shouldDirty: true }); } if (!val) { form.setValue("pep1Sticks", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizza", 0, { shouldDirty: true }); } }}
                        options={pepTypes}
                        onAddOption={addPepType}
                        onRemoveOption={removePepType}
                        allowClear
                      />
                      {(v.pep1Type ?? "").trim() && (
                        <>
                          <NumField
                            control={form.control}
                            name="pep1Sticks"
                            label="Number of Sticks"
                          />
                          {DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") ? (
                            <NumField
                              control={form.control}
                              name="pep1OzPerPizza"
                              label="Oz Per Pizza"
                            />
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              <NumField
                                control={form.control}
                                name="pep1OzPerPizza"
                                label="Oz Per Pizza"
                              />
                              <NumField
                                control={form.control}
                                name="pep1BatchLbs"
                                label="Batch Weight (lbs)"
                              />
                            </div>
                          )}
                        </>
                      )}

                      <TypeDropdown
                        label="Pep Applicator 2"
                        value={v.pep2Type}
                        onChange={val => { form.setValue("pep2Type", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep2BatchLbs", 0, { shouldDirty: true }); } if (!val) { form.setValue("pep2Sticks", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizza", 0, { shouldDirty: true }); } }}
                        options={pepTypes}
                        onAddOption={addPepType}
                        onRemoveOption={removePepType}
                        allowClear
                      />
                      {(v.pep2Type ?? "").trim() && (
                        <>
                          <NumField
                            control={form.control}
                            name="pep2Sticks"
                            label="Number of Sticks"
                          />
                          {DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") ? (
                            <NumField
                              control={form.control}
                              name="pep2OzPerPizza"
                              label="Oz Per Pizza"
                            />
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              <NumField
                                control={form.control}
                                name="pep2OzPerPizza"
                                label="Oz Per Pizza"
                              />
                              <NumField
                                control={form.control}
                                name="pep2BatchLbs"
                                label="Batch Weight (lbs)"
                              />
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                    <div className="h-1 bg-primary w-full" />
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Batches Needed
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5">
                      <p className="text-xs text-muted-foreground mb-4">
                        Based on{" "}
                        <span className="font-mono text-foreground">
                          {fmtNum(calc.casesLeftToRun, 0)}
                        </span>{" "}
                        cases ×{" "}
                        <span className="font-mono text-foreground">
                          {v.pizzasPerCase}
                        </span>{" "}
                        pizzas/case
                      </p>
                      <StatRow
                        label="Sauce"
                        value={fmtNum(calc.sauceBatches, 2) + " batches"}
                        testId="output-sauce-batches"
                        highlight={calc.sauceBatches > 0}
                      />
                      <StatRow
                        label={v.app1Type ? `App 1 — ${v.app1Type}` : "Applicator 1"}
                        value={v.app1Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app1Lbs, 1) + " lbs" : fmtNum(calc.app1Batches, 2) + " batches"}
                        testId="output-app1-batches"
                        highlight={v.app1Type.trim().toLowerCase().includes("mix") ? calc.app1Lbs > 0 : calc.app1Batches > 0}
                      />
                      <StatRow
                        label={v.app2Type ? `App 2 — ${v.app2Type}` : "Applicator 2"}
                        value={v.app2Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app2Lbs, 1) + " lbs" : fmtNum(calc.app2Batches, 2) + " batches"}
                        testId="output-app2-batches"
                        highlight={v.app2Type.trim().toLowerCase().includes("mix") ? calc.app2Lbs > 0 : calc.app2Batches > 0}
                      />
                      <StatRow
                        label={v.app3Type ? `App 3 — ${v.app3Type}` : "Applicator 3"}
                        value={v.app3Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app3Lbs, 1) + " lbs" : fmtNum(calc.app3Batches, 2) + " batches"}
                        testId="output-app3-batches"
                        highlight={v.app3Type.trim().toLowerCase().includes("mix") ? calc.app3Lbs > 0 : calc.app3Batches > 0}
                      />
                      <StatRow
                        label={v.app4Type ? `App 4 — ${v.app4Type}` : "Applicator 4"}
                        value={v.app4Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app4Lbs, 1) + " lbs" : fmtNum(calc.app4Batches, 2) + " batches"}
                        testId="output-app4-batches"
                        highlight={v.app4Type.trim().toLowerCase().includes("mix") ? calc.app4Lbs > 0 : calc.app4Batches > 0}
                      />
                      <Separator className="my-3 opacity-30" />
                      <StatRow
                        label={v.pep1Type ? `Pep 1 — ${v.pep1Type}` : "Pep Applicator 1"}
                        value={DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") ? fmtNum(calc.pep1Lbs, 2) + " lbs" : fmtNum(calc.pep1Batches, 2) + " batches"}
                        testId="output-pep1-batches"
                        highlight={DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") ? calc.pep1Lbs > 0 : calc.pep1Batches > 0}
                      />
                      <StatRow
                        label={v.pep2Type ? `Pep 2 — ${v.pep2Type}` : "Pep Applicator 2"}
                        value={DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") ? fmtNum(calc.pep2Lbs, 2) + " lbs" : fmtNum(calc.pep2Batches, 2) + " batches"}
                        testId="output-pep2-batches"
                        highlight={DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") ? calc.pep2Lbs > 0 : calc.pep2Batches > 0}
                      />
                    </CardContent>
                  </Card>
                </div>

                {/* ─── CHEESE BLEND RECIPES (one per cheese applicator) ─── */}
                {v.app1Type.trim().toLowerCase() === "cheese" && (
                  <CheeseRecipeCard
                    label={v.app1Type || "Applicator 1"}
                    batches={calc.app1Batches}
                    fields={cheese1Fields}
                    recipe={v.app1CheeseRecipe ?? []}
                    fieldPrefix="app1CheeseRecipe"
                    register={form.register}
                    ingredientOptions={cheeseIngredients}
                    onAddIngredient={addCheeseIngredient}
                    onRemoveIngredient={removeCheeseIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app1CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese1({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese1}
                  />
                )}
                {v.app2Type.trim().toLowerCase() === "cheese" && (
                  <CheeseRecipeCard
                    label={v.app2Type || "Applicator 2"}
                    batches={calc.app2Batches}
                    fields={cheese2Fields}
                    recipe={v.app2CheeseRecipe ?? []}
                    fieldPrefix="app2CheeseRecipe"
                    register={form.register}
                    ingredientOptions={cheeseIngredients}
                    onAddIngredient={addCheeseIngredient}
                    onRemoveIngredient={removeCheeseIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app2CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese2({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese2}
                  />
                )}
                {v.app3Type.trim().toLowerCase() === "cheese" && (
                  <CheeseRecipeCard
                    label={v.app3Type || "Applicator 3"}
                    batches={calc.app3Batches}
                    fields={cheese3Fields}
                    recipe={v.app3CheeseRecipe ?? []}
                    fieldPrefix="app3CheeseRecipe"
                    register={form.register}
                    ingredientOptions={cheeseIngredients}
                    onAddIngredient={addCheeseIngredient}
                    onRemoveIngredient={removeCheeseIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app3CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese3({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese3}
                  />
                )}
                {v.app4Type.trim().toLowerCase() === "cheese" && (
                  <CheeseRecipeCard
                    label={v.app4Type || "Applicator 4"}
                    batches={calc.app4Batches}
                    fields={cheese4Fields}
                    recipe={v.app4CheeseRecipe ?? []}
                    fieldPrefix="app4CheeseRecipe"
                    register={form.register}
                    ingredientOptions={cheeseIngredients}
                    onAddIngredient={addCheeseIngredient}
                    onRemoveIngredient={removeCheeseIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app4CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese4({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese4}
                  />
                )}

                {/* ─── MIX RECIPES (any applicator whose name contains "mix") ─── */}
                {v.app1Type.trim().toLowerCase().includes("mix") && (
                  <MixRecipeCard
                    label={v.app1Type || "Applicator 1"}
                    totalRunLbs={calc.app1Lbs}
                    fields={cheese1Fields}
                    recipe={v.app1CheeseRecipe ?? []}
                    fieldPrefix="app1CheeseRecipe"
                    register={form.register}
                    ingredientOptions={mixIngredients}
                    onAddIngredient={addMixIngredient}
                    onRemoveIngredient={removeMixIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app1CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese1({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese1}
                  />
                )}
                {v.app2Type.trim().toLowerCase().includes("mix") && (
                  <MixRecipeCard
                    label={v.app2Type || "Applicator 2"}
                    totalRunLbs={calc.app2Lbs}
                    fields={cheese2Fields}
                    recipe={v.app2CheeseRecipe ?? []}
                    fieldPrefix="app2CheeseRecipe"
                    register={form.register}
                    ingredientOptions={mixIngredients}
                    onAddIngredient={addMixIngredient}
                    onRemoveIngredient={removeMixIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app2CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese2({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese2}
                  />
                )}
                {v.app3Type.trim().toLowerCase().includes("mix") && (
                  <MixRecipeCard
                    label={v.app3Type || "Applicator 3"}
                    totalRunLbs={calc.app3Lbs}
                    fields={cheese3Fields}
                    recipe={v.app3CheeseRecipe ?? []}
                    fieldPrefix="app3CheeseRecipe"
                    register={form.register}
                    ingredientOptions={mixIngredients}
                    onAddIngredient={addMixIngredient}
                    onRemoveIngredient={removeMixIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app3CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese3({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese3}
                  />
                )}
                {v.app4Type.trim().toLowerCase().includes("mix") && (
                  <MixRecipeCard
                    label={v.app4Type || "Applicator 4"}
                    totalRunLbs={calc.app4Lbs}
                    fields={cheese4Fields}
                    recipe={v.app4CheeseRecipe ?? []}
                    fieldPrefix="app4CheeseRecipe"
                    register={form.register}
                    ingredientOptions={mixIngredients}
                    onAddIngredient={addMixIngredient}
                    onRemoveIngredient={removeMixIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`app4CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendCheese4({ ingredient: "", lbs: 0 })}
                    onRemove={removeCheese4}
                  />
                )}
                {v.frontlineRecipeName.trim() && (
                  <FrontlineRecipeCard
                    fields={frontlineFields}
                    recipe={v.frontlineRecipe ?? []}
                    register={form.register}
                    ingredientOptions={frontlineIngredients}
                    onAddIngredient={addFrontlineIngredient}
                    onRemoveIngredient={removeFrontlineIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`frontlineRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendFrontline({ ingredient: "", lbs: 0 })}
                    onRemove={removeFrontline}
                    recipeName={v.frontlineRecipeName ?? ""}
                    recipeNameOptions={frontlineRecipeNames}
                    onAddRecipeName={addFrontlineRecipeName}
                    onRemoveRecipeName={removeFrontlineRecipeName}
                    onRecipeNameChange={val => form.setValue("frontlineRecipeName", val, { shouldDirty: true })}
                  />
                )}
                </div>
                </fieldset>
              </TabsContent>

              {/* ─── SUMMARY ─── */}
              <TabsContent value="summary">
                {(() => {
                  const finishedRuns = dayState.runs.filter(r => !!r.endedAt);
                  const upcomingRuns = dayState.runs.filter((r, i) => !r.endedAt && i !== dayState.currentIndex);

                  function SummaryCard({ run, isCurrent, readOnly, runVals }: { run: RunMeta; isCurrent?: boolean; readOnly?: boolean; runVals?: FormValues }) {
                    const vals = runVals ?? (isCurrent ? v : loadRunValues(run.id));
                    const s = computeSummaryStats(vals);
                    const isFinished = !!run.endedAt;
                    const actualDurationSec = run.startedAt && run.endedAt
                      ? (run.endedAt - run.startedAt) / 1000
                      : null;
                    const frontlineItems: { label: string; value: string }[] = [];
                    if (s.sauceBatches > 0) frontlineItems.push({ label: "Sauce", value: fmtNum(s.sauceBatches, 2) + " barrels" });
                    if (s.app1Type) { const isMix = s.app1Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app1Lbs > 0 : s.app1Batches > 0) frontlineItems.push({ label: `App 1 — ${s.app1Type}`, value: isMix ? fmtNum(s.app1Lbs, 1) + " lbs" : fmtNum(s.app1Batches, 2) + " batches" }); }
                    if (s.app2Type) { const isMix = s.app2Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app2Lbs > 0 : s.app2Batches > 0) frontlineItems.push({ label: `App 2 — ${s.app2Type}`, value: isMix ? fmtNum(s.app2Lbs, 1) + " lbs" : fmtNum(s.app2Batches, 2) + " batches" }); }
                    if (s.app3Type) { const isMix = s.app3Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app3Lbs > 0 : s.app3Batches > 0) frontlineItems.push({ label: `App 3 — ${s.app3Type}`, value: isMix ? fmtNum(s.app3Lbs, 1) + " lbs" : fmtNum(s.app3Batches, 2) + " batches" }); }
                    if (s.app4Type) { const isMix = s.app4Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app4Lbs > 0 : s.app4Batches > 0) frontlineItems.push({ label: `App 4 — ${s.app4Type}`, value: isMix ? fmtNum(s.app4Lbs, 1) + " lbs" : fmtNum(s.app4Batches, 2) + " batches" }); }
                    if (s.pep1Type) frontlineItems.push({ label: `Pep 1 — ${s.pep1Type}`, value: DEFAULT_PEP_TYPES.includes(s.pep1Type) ? fmtNum(s.pep1Lbs, 2) + " lbs" : fmtNum(s.pep1Batches, 2) + " batches" });
                    if (s.pep2Type) frontlineItems.push({ label: `Pep 2 — ${s.pep2Type}`, value: DEFAULT_PEP_TYPES.includes(s.pep2Type) ? fmtNum(s.pep2Lbs, 2) + " lbs" : fmtNum(s.pep2Batches, 2) + " batches" });
                    const canEdit = !readOnly && (isSupervisor || isCurrent);
                    const caseDelta = run.actualCases != null ? run.actualCases - s.totalCases : null;

                    return (
                      <Card
                        className={`border-border/50 shadow-md ${!readOnly ? "cursor-pointer transition-colors hover:bg-accent/30" : ""} ${isCurrent ? "bg-primary/10 border-primary/40" : isFinished ? "bg-emerald-950/20 border-emerald-700/30" : "bg-card/50"}`}
                        onClick={readOnly ? undefined : () => { const idx = dayState.runs.indexOf(run); if (idx !== -1) { switchToRun(idx); setActiveTab("info"); } }}
                      >
                        <CardHeader className="pb-2 pt-4 px-5">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="text-base font-semibold">{runLabel(run)}</CardTitle>
                            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${isCurrent ? "bg-primary/20 text-primary" : isFinished ? "bg-emerald-700/30 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                              {isCurrent ? "Current" : isFinished ? "Finished" : "Upcoming"}
                            </span>
                          </div>
                        </CardHeader>
                        <CardContent className="px-5 pb-4 space-y-3" onClick={e => e.stopPropagation()}>
                          {/* Time & cases row */}
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-background/40 rounded-lg py-2 px-1">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Planned</div>
                              <div className="text-lg font-bold tabular-nums">{fmtComma(s.totalCases)}</div>
                              <div className="text-[10px] text-muted-foreground">cases</div>
                            </div>
                            <div className="bg-background/40 rounded-lg py-2 px-1">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Pizzas</div>
                              <div className="text-lg font-bold tabular-nums">{fmtComma(s.totalPizzas)}</div>
                              <div className="text-[10px] text-muted-foreground">&nbsp;</div>
                            </div>
                            <div className="bg-background/40 rounded-lg py-2 px-1">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                {isFinished ? "Duration" : isCurrent ? "Time Left" : "Est. Time"}
                              </div>
                              <div className="text-lg font-bold">
                                {isFinished && actualDurationSec !== null
                                  ? fmtTime(actualDurationSec)
                                  : isCurrent
                                    ? fmtTime(calc.totalTimeSec)
                                    : fmtTime(s.estimatedTimeSec)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">&nbsp;</div>
                            </div>
                          </div>

                          {/* Waste tracking — actual cases + waste lbs (finished or supervisor) */}
                          {(isFinished || isSupervisor) && !readOnly && (
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <div>
                                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Actual Cases</label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number" min="0" step="1"
                                    value={run.actualCases ?? ""}
                                    placeholder={String(s.totalCases)}
                                    disabled={!canEdit}
                                    onChange={e => updateRunMeta(run.id, { actualCases: e.target.value === "" ? undefined : Number(e.target.value) })}
                                    className="h-8 w-full px-2 rounded bg-muted/40 border border-border/40 text-sm font-mono outline-none focus:border-primary/60 disabled:opacity-50"
                                  />
                                  {caseDelta !== null && (
                                    <span className={`text-xs font-semibold tabular-nums shrink-0 ${caseDelta >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                                      {caseDelta >= 0 ? `+${caseDelta}` : caseDelta}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Waste (lbs)</label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number" min="0" step="0.1"
                                    value={run.wasteLbs ?? ""}
                                    placeholder="0"
                                    disabled={!canEdit}
                                    onChange={e => updateRunMeta(run.id, { wasteLbs: e.target.value === "" ? undefined : Number(e.target.value) })}
                                    className="h-8 w-full px-2 rounded bg-muted/40 border border-border/40 text-sm font-mono outline-none focus:border-primary/60 disabled:opacity-50"
                                  />
                                  {(run.wasteLbs ?? 0) > 0 && (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          {/* Read-only waste display for history */}
                          {readOnly && (run.actualCases != null || run.wasteLbs != null) && (
                            <div className="flex gap-4 text-xs">
                              {run.actualCases != null && <span className="text-muted-foreground">Actual: <span className="text-foreground font-semibold tabular-nums">{fmtComma(run.actualCases)} cases</span></span>}
                              {run.wasteLbs != null && run.wasteLbs > 0 && <span className="text-amber-400/80">Waste: <span className="font-semibold tabular-nums">{fmtNum(run.wasteLbs, 1)} lbs</span></span>}
                            </div>
                          )}

                          {/* Expected cases by now — only for running current run */}
                          {isCurrent && run.startedAt && !run.endedAt && (() => {
                            const ppm = vals.crustsPerCycle * vals.cycleSpeed * vals.speedAdjustment;
                            const expectedCases = ppm > 0 && vals.pizzasPerCase > 0
                              ? Math.floor(ppm * liveFreezerMin / vals.pizzasPerCase)
                              : 0;
                            return (
                              <div className="flex items-center justify-between bg-primary/10 border border-primary/25 rounded-lg px-4 py-2">
                                <span className="text-xs text-primary/80 font-medium">Expected cases by now</span>
                                <span className="text-xl font-bold text-primary tabular-nums">{fmtComma(expectedCases)}</span>
                              </div>
                            );
                          })()}
                          {/* Actual vs expected duration — only for finished runs */}
                          {isFinished && actualDurationSec !== null && s.estimatedTimeSec > 0 && (() => {
                            const diffSec = actualDurationSec - s.estimatedTimeSec;
                            const ahead = diffSec < 0;
                            const absDiff = Math.abs(diffSec);
                            return (
                              <div className={`flex items-center justify-between rounded-lg px-4 py-2 border ${ahead ? "bg-emerald-950/30 border-emerald-700/30" : "bg-amber-950/30 border-amber-700/30"}`}>
                                <div className="space-y-0.5">
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Time Comparison</div>
                                  <div className="flex gap-3 text-xs">
                                    <span className="text-muted-foreground">Actual: <span className="text-foreground font-medium">{fmtTime(actualDurationSec)}</span></span>
                                    <span className="text-muted-foreground">Expected: <span className="text-foreground font-medium">{fmtTime(s.estimatedTimeSec)}</span></span>
                                  </div>
                                </div>
                                <div className={`text-right text-sm font-bold ${ahead ? "text-emerald-400" : "text-amber-400"}`}>
                                  {ahead ? `−${fmtTime(absDiff)}` : `+${fmtTime(absDiff)}`}
                                  <div className="text-[10px] font-normal">{ahead ? "ahead" : "over"}</div>
                                </div>
                              </div>
                            );
                          })()}
                          {/* Start / end times for started runs */}
                          {run.startedAt && (
                            <div className="flex gap-3 text-xs text-muted-foreground">
                              <span>Started: <span className="text-foreground font-medium">{fmtClock(run.startedAt)}</span></span>
                              {run.endedAt && <span>Ended: <span className="text-foreground font-medium">{fmtClock(run.endedAt)}</span></span>}
                            </div>
                          )}
                          {/* Frontline totals */}
                          {frontlineItems.length > 0 && (
                            <div className="pt-1 border-t border-border/30">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Frontline Totals</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                {frontlineItems.map(item => (
                                  <div key={item.label} className="flex justify-between text-xs py-0.5">
                                    <span className="text-muted-foreground truncate mr-2">{item.label}</span>
                                    <span className="font-medium tabular-nums shrink-0">{item.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Notes / shift log */}
                          <div className="pt-1 border-t border-border/30">
                            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1 mb-1.5">
                              <FileText className="w-3 h-3" /> Notes
                            </label>
                            {canEdit ? (
                              <textarea
                                rows={2}
                                value={run.notes ?? ""}
                                placeholder="Shift notes, line issues, observations…"
                                onChange={e => updateRunMeta(run.id, { notes: e.target.value })}
                                className="w-full px-2 py-1.5 rounded bg-muted/40 border border-border/40 text-sm outline-none focus:border-primary/60 resize-none placeholder:text-muted-foreground/50"
                              />
                            ) : (
                              <p className="text-sm text-muted-foreground italic min-h-[2rem]">
                                {run.notes || "—"}
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  }

                  // ── Day Totals ──────────────────────────────────────────
                  const allRunStats = dayState.runs.map(run => {
                    const vals = run.id === currentRun.id ? v : loadRunValues(run.id);
                    return computeSummaryStats(vals);
                  });
                  const dayTotalCases = allRunStats.reduce((sum, s) => sum + s.totalCases, 0);
                  const dayTotalPizzas = allRunStats.reduce((sum, s) => sum + s.totalPizzas, 0);
                  const dayActualCases = dayState.runs.reduce((sum, r) => sum + (r.actualCases ?? 0), 0);

                  // ── Shopping List ─────────────────────────────────────────
                  // Aggregate ingredient quantities across all runs for today
                  type ShopItem = { name: string; totalQty: number; unit: string };
                  const shopMap = new Map<string, ShopItem>();
                  function shopAdd(name: string, qty: number, unit: string) {
                    if (!name || qty <= 0) return;
                    const key = `${name}__${unit}`;
                    const existing = shopMap.get(key);
                    if (existing) existing.totalQty += qty;
                    else shopMap.set(key, { name, totalQty: qty, unit });
                  }
                  for (const run of dayState.runs) {
                    const vals = run.id === currentRun.id ? v : loadRunValues(run.id);
                    const s = computeSummaryStats(vals);
                    // Dough batches needed (calc inline from vals)
                    const totalPizzas = s.totalPizzas;
                    const doughBatches = vals.doughBatchYield > 0
                      ? Math.ceil((totalPizzas * vals.targetDoughballWeight) / vals.doughBatchYield)
                      : 0;
                    // Sauce
                    if (s.sauceBatches > 0) shopAdd("Sauce", s.sauceBatches, "barrels");
                    // Dough ingredients
                    for (const row of (vals.doughRecipe ?? [])) {
                      if (row.ingredient && row.lbs > 0 && doughBatches > 0) {
                        shopAdd(row.ingredient, row.lbs * doughBatches, "lbs");
                      }
                    }
                    // Per-applicator cheese/mix recipe
                    const allRecipes = [
                      ...(vals.app1CheeseRecipe ?? []),
                      ...(vals.app2CheeseRecipe ?? []),
                      ...(vals.app3CheeseRecipe ?? []),
                      ...(vals.app4CheeseRecipe ?? []),
                    ];
                    for (const row of allRecipes) {
                      if (row.ingredient && row.lbs > 0) shopAdd(row.ingredient, row.lbs, "lbs");
                    }
                    // Pep
                    if (s.pep1Type && s.pep1Lbs > 0) shopAdd(`Pep — ${s.pep1Type}`, s.pep1Lbs, "lbs");
                    if (s.pep2Type && s.pep2Lbs > 0) shopAdd(`Pep — ${s.pep2Type}`, s.pep2Lbs, "lbs");
                  }
                  const shopList = [...shopMap.values()].sort((a, b) => a.name.localeCompare(b.name));

                  return (
                    <div className="space-y-6">
                      {/* Export buttons */}
                      <div className="flex gap-2 justify-end print:hidden">
                        <button
                          type="button"
                          onClick={printSummary}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" /> Print
                        </button>
                        <button
                          type="button"
                          onClick={exportCSV}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> Export CSV
                        </button>
                      </div>

                      {/* Day Totals banner */}
                      {dayState.runs.length > 1 && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
                          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-primary">
                            <FileText className="w-4 h-4" />
                            Day Totals — {dayState.runs.length} runs
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="flex flex-col items-center">
                              <span className="text-2xl font-bold tabular-nums">{fmtComma(dayTotalCases)}</span>
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Cases (est.)</span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="text-2xl font-bold tabular-nums">{fmtComma(dayTotalPizzas)}</span>
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Pizzas</span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className={`text-2xl font-bold tabular-nums ${dayActualCases > 0 ? (dayActualCases >= dayTotalCases ? "text-emerald-400" : "text-amber-400") : "text-muted-foreground"}`}>
                                {dayActualCases > 0 ? fmtComma(dayActualCases) : "—"}
                              </span>
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Cases (actual)</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Shopping List */}
                      {shopList.length > 0 && (
                        <div className="rounded-xl border border-border/40 bg-card/40 px-5 py-4">
                          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-muted-foreground">
                            <AlertTriangle className="w-4 h-4" />
                            Ingredient Totals (all runs today)
                          </div>
                          <div className="space-y-1.5">
                            {shopList.map(item => (
                              <div key={`${item.name}__${item.unit}`} className="flex justify-between text-sm">
                                <span className="text-foreground/80">{item.name}</span>
                                <span className="font-semibold tabular-nums">{fmtNum(item.totalQty, 1)} {item.unit}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Finished */}
                      {finishedRuns.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" />
                            Finished ({finishedRuns.length})
                          </div>
                          {finishedRuns.map(run => <SummaryCard key={run.id} run={run} />)}
                        </div>
                      )}
                      {/* Current */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                          <Timer className="w-4 h-4" />
                          Current Run
                        </div>
                        <SummaryCard run={currentRun} isCurrent />
                      </div>
                      {/* Upcoming */}
                      {upcomingRuns.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                            <Clock className="w-4 h-4" />
                            Upcoming ({upcomingRuns.length})
                          </div>
                          {upcomingRuns.map(run => <SummaryCard key={run.id} run={run} />)}
                        </div>
                      )}
                      {/* History */}
                      {history.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-border/30">
                          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                            <History className="w-4 h-4" />
                            History ({history.length} {history.length === 1 ? "day" : "days"})
                          </div>
                          {history.map(day => (
                            <div key={day.date} className="rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                              <button
                                type="button"
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-accent/20 transition-colors"
                                onClick={() => setExpandedHistoryDay(expandedHistoryDay === day.date ? null : day.date)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{day.date}</span>
                                  <span className="text-xs text-muted-foreground">{day.runs.length} run{day.runs.length !== 1 ? "s" : ""} · {day.runs.filter(r => r.endedAt).length} finished</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); exportHistoryCSV(day); }}
                                    className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border border-border/40 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <Download className="w-3 h-3" /> CSV
                                  </button>
                                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expandedHistoryDay === day.date ? "rotate-180" : ""}`} />
                                </div>
                              </button>
                              {expandedHistoryDay === day.date && (
                                <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
                                  {day.runs.map(run => (
                                    <SummaryCard
                                      key={run.id}
                                      run={run}
                                      readOnly
                                      runVals={day.runValues[run.id] as FormValues | undefined}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </TabsContent>

            </Tabs>
          </form>
        </Form>


      </div>
    </div>
  );
}
