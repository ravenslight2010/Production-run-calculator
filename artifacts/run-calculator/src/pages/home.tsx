import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Factory,
  Printer,
  Layers,
  Clock,
  Droplets,
  ClipboardList,
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

const STORAGE_KEY = "run-calc-v1";

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
  skidsCompleted: 5,
  casesOnCurrentSkid: 6,
  traysOnLine: 43,
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
};

function loadSavedValues(): FormValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_VALUES, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_VALUES;
}

export default function Home() {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: loadSavedValues(),
    mode: "onChange",
  });

  const v = form.watch();

  const [activeTab, setActiveTab] = useState("info");
  const [nowTime, setNowTime] = useState(() => new Date());
  const [runToTime, setRunToTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [batchMixMinutes, setBatchMixMinutes] = useState(10);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
  }, [v]);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const calc = useMemo(() => {
    const ppm =
      v.crustsPerCycle * v.cycleSpeed * v.speedAdjustment;

    const traysPerSkid =
      (v.casesPerSkid * v.pizzasPerCase) / v.doughballsPerTray;
    const traysPerBatch = v.doughBatchYield / v.doughballsPerTray;
    const batchesPerSkid = traysPerSkid / traysPerBatch;

    // Spreadsheet: casesOnLine = ROUNDDOWN(ppm * freezerTime / pizzasPerCase * speedAdj, 0)
    const freezerTime = Number(v.freezerTime);
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
  }, [v]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 font-sans">
      <div className="max-w-5xl mx-auto space-y-5">
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
                  const batchesPossible = batchMixMinutes > 0 ? Math.floor(minutesAvailable / batchMixMinutes) : 0;
                  const doughballsPossible = batchesPossible * Number(v.doughBatchYield);
                  const casesCovered = Number(v.pizzasPerCase) > 0 ? doughballsPossible / Number(v.pizzasPerCase) : 0;
                  const nowLabel = `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`;
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
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Min / Batch</label>
                            <input
                              type="number"
                              min={1}
                              value={batchMixMinutes}
                              onChange={(e) => setBatchMixMinutes(Math.max(1, Number(e.target.value)))}
                              className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </div>
                        </div>
                        <Separator className="mb-4 opacity-30" />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold text-amber-400">{Math.round(minutesAvailable)}</p>
                            <p className="text-xs text-muted-foreground mt-1">Minutes available</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold text-primary">{batchesPossible}</p>
                            <p className="text-xs text-muted-foreground mt-1">Batches possible</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold">{fmtNum(doughballsPossible, 0)}</p>
                            <p className="text-xs text-muted-foreground mt-1">Doughballs made</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold">{fmtNum(casesCovered, 1)}</p>
                            <p className="text-xs text-muted-foreground mt-1">Cases covered</p>
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
                          label="Freezer Time"
                          value={fmtNum(Number(v.freezerTime), 1) + " min"}
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

                      <SectionLabel>Applicator 1</SectionLabel>
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

                      <SectionLabel>Applicator 2</SectionLabel>
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

                      <SectionLabel>Applicator 3</SectionLabel>
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

                      <SectionLabel>Applicator 4</SectionLabel>
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
                        label="Applicator 1"
                        value={fmtNum(calc.app1Batches, 2) + " batches"}
                        testId="output-app1-batches"
                        highlight={calc.app1Batches > 0}
                      />
                      <StatRow
                        label="Applicator 2"
                        value={fmtNum(calc.app2Batches, 2) + " batches"}
                        testId="output-app2-batches"
                        highlight={calc.app2Batches > 0}
                      />
                      <StatRow
                        label="Applicator 3"
                        value={fmtNum(calc.app3Batches, 2) + " batches"}
                        testId="output-app3-batches"
                        highlight={calc.app3Batches > 0}
                      />
                      <StatRow
                        label="Applicator 4"
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
