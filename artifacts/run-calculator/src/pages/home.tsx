import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Activity, Clock, Settings, Factory, Timer, CalendarDays } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  targetQuantity: z.coerce.number().min(0, "Must be positive").default(5000),
  unitsPerRun: z.coerce.number().min(0, "Must be positive").default(250),
  runTime: z.coerce.number().min(0, "Must be positive").default(45),
  runTimeUnit: z.enum(["minutes", "hours"]).default("minutes"),
  setupTime: z.coerce.number().min(0, "Must be positive").default(15),
  setupTimeUnit: z.enum(["minutes", "hours"]).default("minutes"),
  efficiency: z.coerce.number().min(0).max(100, "Max 100%").default(95),
  workingHoursPerDay: z.coerce.number().min(0.1, "Must be > 0").default(8),
});

type FormValues = z.infer<typeof formSchema>;

export default function Home() {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      targetQuantity: 5000,
      unitsPerRun: 250,
      runTime: 45,
      runTimeUnit: "minutes",
      setupTime: 15,
      setupTimeUnit: "minutes",
      efficiency: 95,
      workingHoursPerDay: 8,
    },
    mode: "onChange",
  });

  const {
    targetQuantity,
    unitsPerRun,
    runTime,
    runTimeUnit,
    setupTime,
    setupTimeUnit,
    efficiency,
    workingHoursPerDay,
  } = form.watch();

  // Calculations
  const isValid =
    targetQuantity > 0 &&
    unitsPerRun > 0 &&
    efficiency > 0 &&
    workingHoursPerDay > 0 &&
    runTime >= 0 &&
    setupTime >= 0;

  const effectiveUnitsPerRun = unitsPerRun * (efficiency / 100);
  const runsRequired =
    isValid && effectiveUnitsPerRun > 0 ? Math.ceil(targetQuantity / effectiveUnitsPerRun) : 0;

  const runTimeMins = runTimeUnit === "hours" ? runTime * 60 : runTime;
  const setupTimeMins = setupTimeUnit === "hours" ? setupTime * 60 : setupTime;

  const totalRunTimeMins = runsRequired * runTimeMins;
  const totalSetupTimeMins = runsRequired * setupTimeMins;
  const totalProductionTimeMins = totalRunTimeMins + totalSetupTimeMins;

  const daysToComplete =
    isValid && workingHoursPerDay > 0
      ? totalProductionTimeMins / 60 / workingHoursPerDay
      : 0;
  const roundedDays = Math.ceil(daysToComplete * 10) / 10;

  const formatTime = (totalMins: number) => {
    if (!isValid || totalMins === 0) return "—";
    const h = Math.floor(totalMins / 60);
    const m = Math.round(totalMins % 60);
    if (h === 0 && m === 0) return "0m";
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  // Dark mode class handler since it's a standalone frontend
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center space-x-3 mb-8">
          <div className="w-10 h-10 rounded bg-primary text-primary-foreground flex items-center justify-center">
            <Factory className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Production Run Calculator</h1>
            <p className="text-sm text-muted-foreground">Precision manufacturing planning & schedule estimation</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Inputs Panel */}
          <Card className="lg:col-span-5 bg-card/50 backdrop-blur border-border/50 shadow-lg">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="w-5 h-5 text-primary" />
                Run Parameters
              </CardTitle>
              <CardDescription>Enter the specifications for the production run</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form className="space-y-5">
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="targetQuantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Target Quantity</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type="number"
                                className="font-mono text-lg bg-background/50 h-11"
                                placeholder="0"
                                data-testid="input-target-quantity"
                                {...field}
                                onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="unitsPerRun"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Units Per Run</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              className="font-mono text-lg bg-background/50 h-11"
                              placeholder="0"
                              data-testid="input-units-per-run"
                              {...field}
                              onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-3 gap-3">
                      <FormField
                        control={form.control}
                        name="runTime"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Run Time</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                className="font-mono text-lg bg-background/50 h-11"
                                placeholder="0"
                                data-testid="input-run-time"
                                {...field}
                                onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="runTimeUnit"
                        render={({ field }) => (
                          <FormItem className="pt-[22px]">
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-11 bg-background/50" data-testid="select-run-time-unit">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="minutes">mins</SelectItem>
                                <SelectItem value="hours">hours</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <FormField
                        control={form.control}
                        name="setupTime"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Setup Time Per Run</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                className="font-mono text-lg bg-background/50 h-11"
                                placeholder="0"
                                data-testid="input-setup-time"
                                {...field}
                                onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="setupTimeUnit"
                        render={({ field }) => (
                          <FormItem className="pt-[22px]">
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-11 bg-background/50" data-testid="select-setup-time-unit">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="minutes">mins</SelectItem>
                                <SelectItem value="hours">hours</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <FormField
                        control={form.control}
                        name="efficiency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Machine Efficiency</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  type="number"
                                  className="font-mono text-lg pr-8 bg-background/50 h-11"
                                  placeholder="100"
                                  data-testid="input-efficiency"
                                  {...field}
                                  onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="workingHoursPerDay"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Working Hours / Day</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                className="font-mono text-lg bg-background/50 h-11"
                                placeholder="8"
                                data-testid="input-working-hours"
                                step="0.5"
                                {...field}
                                onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Results Panel */}
          <div className="lg:col-span-7 space-y-4">
            <Card className="bg-card border-border shadow-xl overflow-hidden relative">
              {/* Top Accent line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
              
              <CardContent className="p-6 md:p-8">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold tracking-tight">Production Estimate</h2>
                  {!isValid && (
                    <span className="text-sm font-medium text-destructive px-2 py-1 bg-destructive/10 rounded" data-testid="status-invalid">
                      Invalid inputs
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                  {/* Primary Output: Runs */}
                  <div className="bg-background/50 p-6 rounded-lg border border-border/50 flex flex-col justify-center">
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                      <Activity className="w-4 h-4" />
                      <span className="text-sm font-medium uppercase tracking-wider">Runs Required</span>
                    </div>
                    <div className="text-5xl lg:text-6xl font-mono font-bold text-primary" data-testid="output-runs-required">
                      {isValid ? runsRequired : "—"}
                    </div>
                  </div>

                  {/* Primary Output: Days */}
                  <div className="bg-background/50 p-6 rounded-lg border border-border/50 flex flex-col justify-center">
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                      <CalendarDays className="w-4 h-4" />
                      <span className="text-sm font-medium uppercase tracking-wider">Days to Complete</span>
                    </div>
                    <div className="text-5xl lg:text-6xl font-mono font-bold text-foreground" data-testid="output-days-required">
                      {isValid ? roundedDays : "—"}
                    </div>
                  </div>
                </div>

                <Separator className="my-8 opacity-50" />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div>
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                      <Clock className="w-4 h-4" />
                      <span className="text-xs font-medium uppercase tracking-wider">Total Run Time</span>
                    </div>
                    <div className="text-2xl font-mono font-semibold" data-testid="output-total-run-time">
                      {formatTime(totalRunTimeMins)}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                      <Settings className="w-4 h-4" />
                      <span className="text-xs font-medium uppercase tracking-wider">Total Setup</span>
                    </div>
                    <div className="text-2xl font-mono font-semibold" data-testid="output-total-setup-time">
                      {formatTime(totalSetupTimeMins)}
                    </div>
                  </div>

                  <div className="sm:pl-6 sm:border-l border-border/50">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                      <Timer className="w-4 h-4 text-primary" />
                      <span className="text-xs font-bold uppercase tracking-wider text-primary">Total Time</span>
                    </div>
                    <div className="text-3xl font-mono font-bold text-foreground" data-testid="output-total-production-time">
                      {formatTime(totalProductionTimeMins)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="text-xs text-muted-foreground text-center pt-4 opacity-60 flex items-center justify-center gap-2">
              <Activity className="w-3 h-3" />
              <span>Live calculations based on {(efficiency || 0)}% efficiency rating</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
