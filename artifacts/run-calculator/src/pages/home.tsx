import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Factory,
  Printer,
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
  Square,
  Timer,
  Trash2,
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
  freezerTime: z.coerce.number().min(0).default(15),
  pizzasPerCase: z.coerce.number().min(1).default(12),
  casesPerSkid: z.coerce.number().min(1).default(48),
  casesPerLayer: z.coerce.number().min(1).default(6),
  doughballsPerTray: z.coerce.number().min(1).default(24),
  doughBatchYield: z.coerce.number().min(1).default(620),
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
  pepOzPerPizza: z.coerce.number().min(0).default(0),
  // Applicator ingredient labels
  app1Type: z.string().default(""),
  app2Type: z.string().default(""),
  app3Type: z.string().default(""),
  app4Type: z.string().default(""),
  // Cheese blend recipe rows
  cheeseRecipe: z.array(
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
  if (!isFinite(n)) return "—";
  return n.toFixed(dec);
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
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
          onClick={() => { setInputVal(""); setOpen(true); }}
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
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Search or add…"
              className="w-full px-3 py-1.5 text-xs bg-transparent border-b border-border/50 outline-none"
            />
            <div className="max-h-48 overflow-y-auto">
              {filtered.map(opt => (
                <button
                  key={opt}
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === opt ? "text-primary font-semibold" : ""}`}
                  onMouseDown={() => { onChange(opt); setOpen(false); }}
                >
                  {opt}
                </button>
              ))}
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
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  step?: string;
  testId?: string;
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
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  min?: number;
  step?: number;
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
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => field.onChange(Math.max(min, current - step))}
                  className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80"
                  data-testid={`btn-dec-${name}`}
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
                />
                <button
                  type="button"
                  onClick={() => field.onChange(current + step)}
                  className="h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80"
                  data-testid={`btn-inc-${name}`}
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
  "Cheese", "Mozzarella", "Cheddar", "Pepperoni", "Sausage",
  "Mushroom", "Green Pepper", "Onion", "Black Olive", "Ham", "Bacon", "Jalapeño",
];
const RUN_KEY = (id: string) => `run-calc-run-${id}`;
const PROFILE_KEY = (brand: string, flavor: string) =>
  `run-calc-profile-${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
const BRANDS_KEY = "run-calc-brands";
const FLAVORS_KEY = "run-calc-flavors";
const MAX_RUNS = 30;

type RunMeta = { id: string; brand: string; flavor: string; startedAt?: number; endedAt?: number };
type DayState = { runs: RunMeta[]; currentIndex: number; date?: string };
type SyncPayload = { dayState: { runs: RunMeta[] }; runValues: Record<string, FormValues> };

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

function loadProfile(brand: string, flavor: string): FormValues | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (raw) return { ...DEFAULT_VALUES, ...JSON.parse(raw) };
  } catch {}
  return null;
}

function saveProfile(brand: string, flavor: string, values: FormValues): void {
  if (!brand && !flavor) return;
  try { localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(values)); } catch {}
}

const DEFAULT_VALUES: FormValues = {
  casesNeeded: 384,
  crustsPerCycle: 5,
  cycleSpeed: 7.8,
  speedAdjustment: 1.0,
  freezerTime: 15,
  pizzasPerCase: 12,
  casesPerSkid: 48,
  casesPerLayer: 6,
  doughballsPerTray: 24,
  doughBatchYield: 620,
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  sauceOzPerPizza: 4,
  sauceBarrelLbs: 450,
  app1OzPerPizza: 0,
  app1BatchLbs: 30,
  app2OzPerPizza: 4,
  app2BatchLbs: 55,
  app3OzPerPizza: 0,
  app3BatchLbs: 45,
  app4OzPerPizza: 4,
  app4BatchLbs: 55,
  pepOzPerPizza: 0,
  app1Type: "",
  app2Type: "",
  app3Type: "",
  app4Type: "",
  cheeseRecipe: [],
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function freshDayState(): DayState {
  return { runs: [{ id: genId(), brand: "Lucia's", flavor: "Cheese" }], currentIndex: 0, date: todayStr() };
}

function loadDayState(): DayState {
  try {
    const raw = localStorage.getItem(DAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DayState;
      // Reset if stored date doesn't match today
      if (parsed.date && parsed.date !== todayStr()) {
        return freshDayState();
      }
      // Migrate old shape { id, label } → { id, brand, flavor }
      const runs = parsed.runs.map((r: any) => ({
        id: r.id,
        brand: r.brand ?? (r.label ?? ""),
        flavor: r.flavor ?? "",
        startedAt: r.startedAt,
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

  const [brands, setBrands] = useState<string[]>(() =>
    loadList(BRANDS_KEY, ["Lucia's"])
  );
  const [flavors, setFlavors] = useState<string[]>(() =>
    loadList(FLAVORS_KEY, ["Cheese"])
  );
  const [ingredientTypes, setIngredientTypes] = useState<string[]>(() =>
    loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES)
  );

  function addIngredientType(name: string) {
    const trimmed = name.trim();
    if (!trimmed || ingredientTypes.includes(trimmed)) return;
    const updated = [...ingredientTypes, trimmed];
    setIngredientTypes(updated);
    saveList(INGREDIENT_TYPES_KEY, updated);
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

  const { fields: cheeseFields, append: appendCheeseRow, remove: removeCheeseRow } = useFieldArray({
    control: form.control,
    name: "cheeseRecipe",
  });

  const [activeTab, setActiveTab] = useState("info");
  const [nowTime, setNowTime] = useState(() => new Date());
  const [runToTime, setRunToTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  // Brand/flavor picker state
  const [brandInput, setBrandInput] = useState("");
  const [flavorInput, setFlavorInput] = useState("");
  const [showBrandDrop, setShowBrandDrop] = useState(false);
  const [showFlavorDrop, setShowFlavorDrop] = useState(false);

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
    const updated = [...brands, trimmed];
    setBrands(updated);
    saveList(BRANDS_KEY, updated);
    return trimmed;
  }

  function addFlavor(name: string) {
    const trimmed = name.trim();
    if (!trimmed || flavors.includes(trimmed)) return trimmed ? trimmed : flavors[0];
    const updated = [...flavors, trimmed];
    setFlavors(updated);
    saveList(FLAVORS_KEY, updated);
    return trimmed;
  }

  function startRun() {
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, startedAt: Date.now(), endedAt: undefined } : r
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
      i === dayState.currentIndex ? { ...r, endedAt: Date.now() } : r
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

  const runStatus: "pending" | "running" | "ended" =
    currentRun?.endedAt ? "ended" : currentRun?.startedAt ? "running" : "pending";

  const liveFreezerMin = (() => {
    if (!currentRun?.startedAt) return 0;
    if (currentRun.endedAt) return Number(v.freezerTime);
    const elapsed = (nowTime.getTime() - currentRun.startedAt) / 60000;
    return Math.min(elapsed, Number(v.freezerTime));
  })();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 10_000);
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
      v.crustsPerCycle * v.cycleSpeed * v.speedAdjustment;

    const traysPerSkid =
      (v.casesPerSkid * v.pizzasPerCase) / v.doughballsPerTray;
    const traysPerBatch = v.doughBatchYield / v.doughballsPerTray;
    const batchesPerSkid = traysPerSkid / traysPerBatch;

    // Spreadsheet: casesOnLine = ROUNDDOWN(ppm * freezerTime / pizzasPerCase * speedAdj, 0)
    const freezerTime = liveFreezerMin;
    const casesOnLine =
      ppm > 0
        ? Math.floor((ppm * freezerTime) / v.pizzasPerCase * v.speedAdjustment)
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
    const doughOnHand =
      v.traysOnLine * v.doughballsPerTray +
      v.batchesReady * v.doughBatchYield;
    const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
    const batchesNeeded = doughDeficit / v.doughBatchYield;
    const traysNeeded = doughDeficit / v.doughballsPerTray;
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
    const timePerTraySec =
      ppm > 0 ? (v.doughballsPerTray / v.crustsPerCycle) * timePressHzSec : 0;
    const timePerBatchSec =
      ppm > 0 ? (v.doughBatchYield / ppm) * 60 : 0;
    const timePerSkidSec =
      ppm > 0 ? ((v.casesPerSkid * v.pizzasPerCase) / ppm) * 60 : 0;
    const totalTimeSec =
      ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : 0;
    // Spreadsheet: includes batchesReady dough
    const doughMadeTimeSec =
      ppm > 0
        ? ((v.traysOnLine * v.doughballsPerTray +
            v.batchesReady * v.doughBatchYield) /
            ppm) *
          60
        : 0;

    const rackTimes = [10, 12, 16, 18, 20, 22].map((n) => ({
      trays: n,
      sec: ppm > 0 ? (n * v.doughballsPerTray * 60) / ppm : 0,
    }));

    // Frontline — batches = total_oz_needed / (batch_lbs * 16)
    // Spreadsheet adds casesPerLayer as a buffer to sauce total only
    const totalPizzasRun = casesLeftToRun * v.pizzasPerCase;
    const totalPizzasForSauce = totalPizzasRun + v.casesPerLayer;
    const sauceBatches =
      v.sauceBarrelLbs > 0
        ? (totalPizzasForSauce * v.sauceOzPerPizza) / (v.sauceBarrelLbs * 16)
        : 0;
    const app1Batches =
      v.app1BatchLbs > 0
        ? (totalPizzasRun * v.app1OzPerPizza) / (v.app1BatchLbs * 16)
        : 0;
    const app2Batches =
      v.app2BatchLbs > 0
        ? (totalPizzasRun * v.app2OzPerPizza) / (v.app2BatchLbs * 16)
        : 0;
    const app3Batches =
      v.app3BatchLbs > 0
        ? (totalPizzasRun * v.app3OzPerPizza) / (v.app3BatchLbs * 16)
        : 0;
    const app4Batches =
      v.app4BatchLbs > 0
        ? (totalPizzasRun * v.app4OzPerPizza) / (v.app4BatchLbs * 16)
        : 0;
    const pepLbs = (totalPizzasRun * v.pepOzPerPizza) / 16;

    return {
      ppm,
      traysPerSkid,
      traysPerBatch,
      batchesPerSkid,
      casesOnLine,
      casesLeftToRun,
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
      totalTimeSec,
      doughMadeTimeSec,
      rackTimes,
      sauceBatches,
      app1Batches,
      app2Batches,
      app3Batches,
      app4Batches,
      pepLbs,
    };
  }, [v, liveFreezerMin]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 font-sans">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* ─── RUN SELECTOR ─── */}
        <div className="flex items-center gap-2 print:hidden bg-card/40 border border-border/50 rounded-lg px-3 py-2.5">

          {/* Previous run */}
          <div className="flex-1 flex justify-end min-w-0">
            {dayState.currentIndex > 0 ? (
              <button
                type="button"
                onClick={() => switchToRun(dayState.currentIndex - 1)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors max-w-[180px] w-full justify-end"
              >
                <ChevronLeft className="w-4 h-4 shrink-0" />
                <div className="text-right min-w-0">
                  <div className="text-[9px] uppercase tracking-widest opacity-50 font-semibold">Previous</div>
                  <div className="font-medium text-xs truncate">{runLabel(dayState.runs[dayState.currentIndex - 1])}</div>
                </div>
              </button>
            ) : (
              <div className="w-full max-w-[180px]" />
            )}
          </div>

          {/* Current run — brand + flavor pickers */}
          <div className="flex flex-col items-center gap-2 px-4 py-2 rounded-md bg-primary/15 border border-primary/30 shrink-0">
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
                    onBlur={() => setTimeout(() => setShowBrandDrop(false), 150)}
                  />
                  {showBrandDrop && (
                    <div className="absolute z-50 top-full mt-1 left-0 w-40 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto">
                      {brands
                        .filter((b) => b.toLowerCase().includes(brandInput.toLowerCase()))
                        .map((b) => (
                          <button
                            key={b}
                            type="button"
                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.brand === b ? "text-primary font-semibold" : ""}`}
                            onMouseDown={() => {
                              setRunBrandFlavor(b, currentRun?.flavor ?? "");
                              setShowBrandDrop(false);
                            }}
                          >
                            {b}
                          </button>
                        ))}
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
                    onBlur={() => setTimeout(() => setShowFlavorDrop(false), 150)}
                  />
                  {showFlavorDrop && (
                    <div className="absolute z-50 top-full mt-1 left-0 w-40 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto">
                      {flavors
                        .filter((f) => f.toLowerCase().includes(flavorInput.toLowerCase()))
                        .map((f) => (
                          <button
                            key={f}
                            type="button"
                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.flavor === f ? "text-primary font-semibold" : ""}`}
                            onMouseDown={() => {
                              setRunBrandFlavor(currentRun?.brand ?? "", f);
                              setShowFlavorDrop(false);
                            }}
                          >
                            {f}
                          </button>
                        ))}
                      {flavorInput.trim() && !flavors.includes(flavorInput.trim()) && (
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
            <div className="flex items-center gap-2 pt-1">
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
                    onClick={endRun}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-700 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
                  >
                    <Square className="w-3 h-3 fill-current" /> Stop Run
                  </button>
                </>
              )}
              {runStatus === "ended" && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                  Ended
                </span>
              )}
            </div>
          </div>

          {/* Upcoming run */}
          <div className="flex-1 flex justify-start min-w-0">
            {dayState.currentIndex < dayState.runs.length - 1 ? (
              <button
                type="button"
                onClick={() => switchToRun(dayState.currentIndex + 1)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors max-w-[180px] w-full"
              >
                <div className="text-left min-w-0">
                  <div className="text-[9px] uppercase tracking-widest opacity-50 font-semibold">Upcoming</div>
                  <div className="font-medium text-xs truncate">{runLabel(dayState.runs[dayState.currentIndex + 1])}</div>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0" />
              </button>
            ) : (
              <div className="w-full max-w-[180px]" />
            )}
          </div>

          {/* Run count + Add */}
          <div className="flex items-center gap-2 shrink-0 pl-3 border-l border-border/40">
            <span className="text-xs text-muted-foreground tabular-nums">{dayState.runs.length}/{MAX_RUNS}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRun}
              disabled={dayState.runs.length >= MAX_RUNS}
              className="h-7 px-2 gap-1 text-xs"
            >
              <Plus className="w-3 h-3" />
              New Run
            </Button>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              document.body.setAttribute(
                "data-print-date",
                new Date().toLocaleString()
              );
              window.print();
            }}
            className="print:hidden flex items-center gap-2"
            data-testid="button-export-pdf"
          >
            <Printer className="w-4 h-4" />
            Export PDF
          </Button>
        </header>

        <Form {...form}>
          <form>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full print:hidden">
              <TabsList className="grid grid-cols-4 w-full mb-4 print:hidden">
                <TabsTrigger value="info" data-testid="tab-info">
                  <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
                  Enter Info
                </TabsTrigger>
                <TabsTrigger value="dough" data-testid="tab-dough">
                  <Layers className="w-3.5 h-3.5 mr-1.5" />
                  Dough
                </TabsTrigger>
                <TabsTrigger value="timing" data-testid="tab-timing">
                  <Clock className="w-3.5 h-3.5 mr-1.5" />
                  Timing
                </TabsTrigger>
                <TabsTrigger value="frontline" data-testid="tab-frontline">
                  <Droplets className="w-3.5 h-3.5 mr-1.5" />
                  Frontline
                </TabsTrigger>
              </TabsList>

              {/* ─── ENTER INFO ─── */}
              <TabsContent value="info">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Card className="bg-card/50 border-border/50 shadow-md">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Line Settings
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 space-y-3">
                      <NumField
                        control={form.control}
                        name="casesNeeded"
                        label="Cases Needed"
                      />
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
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="speedAdjustment"
                          label="Speed Adjustment"
                        />
                        <NumField
                          control={form.control}
                          name="freezerTime"
                          label="Freezer Time (min)"
                        />
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
                          label="Cases Per Layer"
                          step="1"
                        />
                        <NumField
                          control={form.control}
                          name="doughballsPerTray"
                          label="Doughballs Per Tray"
                          step="1"
                        />
                      </div>
                      <NumField
                        control={form.control}
                        name="doughBatchYield"
                        label="Dough Batch Yield (doughballs)"
                        step="1"
                      />
                    </CardContent>
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
                        label="Total Trays on Line"
                      />
                      <StepperField
                        control={form.control}
                        name="batchesReady"
                        label="Batches of Dough Ready"
                      />
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

                {/* Run to Time card */}
                {(() => {
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
              </TabsContent>

              {/* ─── TIMING ─── */}
              <TabsContent value="timing">
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
                          label="Time for Dough to Clear"
                          value={fmtTime(calc.doughMadeTimeSec)}
                          testId="output-dough-time"
                        />
                        <div className="flex items-center justify-between py-1.5" data-testid="output-dough-depletion">
                          <span className="text-sm text-muted-foreground">Dough Runs Out In</span>
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
                        <StatRow
                          label="Pizzas Per Minute"
                          value={fmtNum(calc.ppm, 1)}
                          testId="output-timing-ppm"
                        />
                        <StatRow
                          label={
                            runStatus === "running"
                              ? `Freezer Time (${fmtNum(liveFreezerMin, 1)} / ${fmtNum(Number(v.freezerTime), 1)} min)`
                              : "Freezer Time"
                          }
                          value={fmtNum(liveFreezerMin, 1) + " min"}
                          testId="output-freezer-time"
                        />
                      </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border/50 shadow-md">
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          Per Unit Times
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        <StatRow
                          label="Time Per Press Cycle"
                          value={fmtNum(calc.timePressHzSec, 2) + "s"}
                          testId="output-time-per-cycle"
                        />
                        <StatRow
                          label="Time Per Tray"
                          value={fmtTime(calc.timePerTraySec)}
                          testId="output-time-per-tray"
                        />
                        <StatRow
                          label="Time Per Batch"
                          value={fmtTime(calc.timePerBatchSec)}
                          testId="output-time-per-batch"
                        />
                        <StatRow
                          label="Time Per Skid"
                          value={fmtTime(calc.timePerSkidSec)}
                          testId="output-time-per-skid"
                          highlight
                        />
                      </CardContent>
                    </Card>
                  </div>

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
                </div>
              </TabsContent>

              {/* ─── FRONTLINE ─── */}
              <TabsContent value="frontline">
                <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Card className="bg-card/50 border-border/50 shadow-md">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Sauce & Applicator Weights
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 space-y-4">
                      <SectionLabel>Sauce</SectionLabel>
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

                      <TypeDropdown
                        label="Applicator 1"
                        value={v.app1Type}
                        onChange={val => form.setValue("app1Type", val, { shouldDirty: true })}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="app1OzPerPizza"
                          label="Oz Per Pizza"
                        />
                        <NumField
                          control={form.control}
                          name="app1BatchLbs"
                          label="Batch Weight (lbs)"
                        />
                      </div>

                      <TypeDropdown
                        label="Applicator 2"
                        value={v.app2Type}
                        onChange={val => form.setValue("app2Type", val, { shouldDirty: true })}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="app2OzPerPizza"
                          label="Oz Per Pizza"
                        />
                        <NumField
                          control={form.control}
                          name="app2BatchLbs"
                          label="Batch Weight (lbs)"
                        />
                      </div>

                      <TypeDropdown
                        label="Applicator 3"
                        value={v.app3Type}
                        onChange={val => form.setValue("app3Type", val, { shouldDirty: true })}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="app3OzPerPizza"
                          label="Oz Per Pizza"
                        />
                        <NumField
                          control={form.control}
                          name="app3BatchLbs"
                          label="Batch Weight (lbs)"
                        />
                      </div>

                      <TypeDropdown
                        label="Applicator 4"
                        value={v.app4Type}
                        onChange={val => form.setValue("app4Type", val, { shouldDirty: true })}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="app4OzPerPizza"
                          label="Oz Per Pizza"
                        />
                        <NumField
                          control={form.control}
                          name="app4BatchLbs"
                          label="Batch Weight (lbs)"
                        />
                      </div>

                      <SectionLabel>Pepperoni</SectionLabel>
                      <NumField
                        control={form.control}
                        name="pepOzPerPizza"
                        label="Oz Per Pizza"
                      />
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
                        value={fmtNum(calc.app1Batches, 2) + " batches"}
                        testId="output-app1-batches"
                        highlight={calc.app1Batches > 0}
                      />
                      <StatRow
                        label={v.app2Type ? `App 2 — ${v.app2Type}` : "Applicator 2"}
                        value={fmtNum(calc.app2Batches, 2) + " batches"}
                        testId="output-app2-batches"
                        highlight={calc.app2Batches > 0}
                      />
                      <StatRow
                        label={v.app3Type ? `App 3 — ${v.app3Type}` : "Applicator 3"}
                        value={fmtNum(calc.app3Batches, 2) + " batches"}
                        testId="output-app3-batches"
                        highlight={calc.app3Batches > 0}
                      />
                      <StatRow
                        label={v.app4Type ? `App 4 — ${v.app4Type}` : "Applicator 4"}
                        value={fmtNum(calc.app4Batches, 2) + " batches"}
                        testId="output-app4-batches"
                        highlight={calc.app4Batches > 0}
                      />
                      <Separator className="my-3 opacity-30" />
                      <StatRow
                        label="Pepperoni"
                        value={fmtNum(calc.pepLbs, 2) + " lbs"}
                        testId="output-pep-lbs"
                        highlight={calc.pepLbs > 0}
                      />
                    </CardContent>
                  </Card>
                </div>

                {/* ─── CHEESE BLEND RECIPE ─── */}
                {(() => {
                  const isC = (t: string) => t.trim().toLowerCase() === "cheese";
                  const cheeseApps = [
                    isC(v.app1Type) && { label: "App 1", batches: calc.app1Batches },
                    isC(v.app2Type) && { label: "App 2", batches: calc.app2Batches },
                    isC(v.app3Type) && { label: "App 3", batches: calc.app3Batches },
                    isC(v.app4Type) && { label: "App 4", batches: calc.app4Batches },
                  ].filter(Boolean) as { label: string; batches: number }[];
                  if (cheeseApps.length === 0) return null;
                  const totalBatches = cheeseApps.reduce((s, a) => s + a.batches, 0);
                  return (
                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                      <div className="h-1 bg-amber-500/70 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Cheese Blend Recipe
                          </CardTitle>
                          <span className="text-xs text-muted-foreground">
                            {cheeseApps.map(a => a.label).join(", ")}
                            {" · "}
                            <span className="font-mono text-foreground">{fmtNum(totalBatches, 2)}</span> batches
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        {cheeseFields.length === 0 ? (
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
                              {cheeseFields.map((field, idx) => {
                                const rowLbs = Number(v.cheeseRecipe?.[idx]?.lbs ?? 0);
                                return (
                                  <div key={field.id} className="grid grid-cols-[1fr_120px_120px_32px] gap-x-2 items-center">
                                    <input
                                      {...form.register(`cheeseRecipe.${idx}.ingredient`)}
                                      placeholder="e.g. Mozzarella"
                                      className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm outline-none focus:border-primary/60 w-full"
                                    />
                                    <input
                                      {...form.register(`cheeseRecipe.${idx}.lbs`, { valueAsNumber: true })}
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      placeholder="0"
                                      className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm text-right font-mono outline-none focus:border-primary/60 w-full"
                                    />
                                    <div className="h-8 px-2 rounded bg-muted/20 border border-border/20 text-sm text-right font-mono flex items-center justify-end text-foreground/80">
                                      {fmtNum(rowLbs * totalBatches, 1)}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeCheeseRow(idx)}
                                      className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            {cheeseFields.length > 0 && (
                              <div className="grid grid-cols-[1fr_120px_120px_32px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
                                <span className="text-xs font-semibold text-muted-foreground">Total</span>
                                <span className="text-xs font-mono text-right text-muted-foreground">
                                  {fmtNum(
                                    (v.cheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0),
                                    1
                                  )} lbs/batch
                                </span>
                                <span className="text-xs font-mono text-right font-semibold text-foreground">
                                  {fmtNum(
                                    (v.cheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0) * totalBatches,
                                    1
                                  )} lbs
                                </span>
                                <span />
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => appendCheeseRow({ ingredient: "", lbs: 0 })}
                          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Ingredient
                        </button>
                      </CardContent>
                    </Card>
                  );
                })()}
                </div>
              </TabsContent>

            </Tabs>
          </form>
        </Form>

        {/* ─── PRINT REPORT (hidden in browser, shown on print) ─── */}
        <div className="hidden print:block text-[11pt] space-y-5" data-print-report>

          {/* Summary bar */}
          <div className="grid grid-cols-4 gap-3 border border-border/60 rounded p-3 bg-card/30">
            <div>
              <p className="text-[8pt] uppercase tracking-wider text-muted-foreground">Cases Needed</p>
              <p className="font-mono font-bold text-lg">{v.casesNeeded}</p>
            </div>
            <div>
              <p className="text-[8pt] uppercase tracking-wider text-muted-foreground">Cases Left to Run</p>
              <p className="font-mono font-bold text-lg text-primary">{fmtNum(calc.casesLeftToRun, 0)}</p>
            </div>
            <div>
              <p className="text-[8pt] uppercase tracking-wider text-muted-foreground">Time Left</p>
              <p className="font-mono font-bold text-lg text-primary">{fmtTime(calc.totalTimeSec)}</p>
            </div>
            <div>
              <p className="text-[8pt] uppercase tracking-wider text-muted-foreground">Pizzas / Min</p>
              <p className="font-mono font-bold text-lg">{fmtNum(calc.ppm, 1)}</p>
            </div>
          </div>

          {/* Inputs */}
          <div>
            <h2 className="text-[8pt] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-1 mb-2">Line Settings</h2>
            <div className="grid grid-cols-4 gap-x-6 gap-y-1">
              {[
                ["Cases Needed", v.casesNeeded],
                ["Crusts / Cycle", v.crustsPerCycle],
                ["Cycle Speed (cyc/min)", v.cycleSpeed],
                ["Speed Adjustment", v.speedAdjustment],
                ["Freezer Time (min)", v.freezerTime],
                ["Pizzas / Case", v.pizzasPerCase],
                ["Cases / Skid", v.casesPerSkid],
                ["Cases / Layer", v.casesPerLayer],
                ["Doughballs / Tray", v.doughballsPerTray],
                ["Dough Batch Yield", v.doughBatchYield],
                ["Skids Completed", v.skidsCompleted],
                ["Cases on Current Skid", v.casesOnCurrentSkid],
                ["Trays on Line", v.traysOnLine],
                ["Batches Ready", v.batchesReady],
              ].map(([label, val]) => (
                <div key={String(label)} className="flex justify-between text-[9pt] py-0.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-semibold">{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Dough */}
            <div>
              <h2 className="text-[8pt] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-1 mb-2">Dough</h2>
              <div className="space-y-0.5">
                {[
                  ["Batches to Mix", fmtNum(calc.batchesNeeded, 2)],
                  ["Trays Needed", fmtNum(calc.traysNeeded, 0)],
                  ["Cases on Line", fmtNum(calc.casesOnLine, 0)],
                  ["Cases on Last Skid", fmtNum(calc.casesOnLastSkid, 0)],
                  ["Trays / Skid", fmtNum(calc.traysPerSkid, 2)],
                  ["Trays / Batch", fmtNum(calc.traysPerBatch, 2)],
                  ["Batches / Skid", fmtNum(calc.batchesPerSkid, 2)],
                ].map(([label, val]) => (
                  <div key={String(label)} className="flex justify-between text-[9pt] py-0.5 border-b border-border/20">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-semibold">{val}</span>
                  </div>
                ))}
                <div className="flex justify-between text-[9pt] py-0.5 border-b border-border/20">
                  <span className="text-muted-foreground">Dough Status</span>
                  <span className={`font-semibold ${calc.doughShortCases > 0 ? "text-red-600" : "text-green-700"}`}>
                    {calc.doughShortCases > 0
                      ? `SHORT ${fmtNum(calc.doughShortCases, 1)} cases`
                      : calc.buffer > 0
                      ? `+${fmtNum(calc.buffer, 1)} cases ahead`
                      : "Balanced"}
                  </span>
                </div>
              </div>
            </div>

            {/* Timing */}
            <div>
              <h2 className="text-[8pt] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-1 mb-2">Timing</h2>
              <div className="space-y-0.5">
                {[
                  ["Total Time Left", fmtTime(calc.totalTimeSec)],
                  ["Time for Dough to Clear", fmtTime(calc.doughMadeTimeSec)],
                  ["Dough Runs Out In", calc.doughDepletionSec > 0 ? fmtTime(calc.doughDepletionSec) : "—"],
                  ["Time / Press Cycle", fmtNum(calc.timePressHzSec, 2) + "s"],
                  ["Time / Tray", fmtTime(calc.timePerTraySec)],
                  ["Time / Batch", fmtTime(calc.timePerBatchSec)],
                  ["Time / Skid", fmtTime(calc.timePerSkidSec)],
                ].map(([label, val]) => (
                  <div key={String(label)} className="flex justify-between text-[9pt] py-0.5 border-b border-border/20">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-semibold">{val}</span>
                  </div>
                ))}
                {calc.rackTimes.map(({ trays, sec }) => (
                  <div key={trays} className="flex justify-between text-[9pt] py-0.5 border-b border-border/20">
                    <span className="text-muted-foreground">{trays}-Tray Rack</span>
                    <span className="font-mono font-semibold">{fmtTime(sec)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Frontline */}
          <div>
            <h2 className="text-[8pt] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-1 mb-2">Frontline Batches</h2>
            <div className="grid grid-cols-3 gap-x-6">
              {[
                ["Sauce", fmtNum(calc.sauceBatches, 2) + " batches"],
                ["Applicator 1", fmtNum(calc.app1Batches, 2) + " batches"],
                ["Applicator 2", fmtNum(calc.app2Batches, 2) + " batches"],
                ["Applicator 3", fmtNum(calc.app3Batches, 2) + " batches"],
                ["Applicator 4", fmtNum(calc.app4Batches, 2) + " batches"],
                ["Pepperoni", fmtNum(calc.pepLbs, 2) + " lbs"],
              ].map(([label, val]) => (
                <div key={String(label)} className="flex justify-between text-[9pt] py-0.5 border-b border-border/20">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-semibold">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
