import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Droplets,
  Factory,
  Layers,
  ListChecks,
  MoreHorizontal,
  Package,
  Warehouse,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAccessibleDialog } from "./useAccessibleDialog";

// Multi-step guided walkthrough that highlights each main tab in sequence.
// As each tab step becomes active it switches the underlying tab (via
// onNavigate) so the user sees the real screen while reading about it. Kept at
// copy/structure parity with the mobile GuidedTour.

type TourStep = {
  icon: LucideIcon;
  title: string;
  body: string;
  // When set, the underlying app switches to this tab as the step is shown.
  tab?: string;
};

function buildSteps(isManager: boolean): TourStep[] {
  const steps: TourStep[] = [
    {
      icon: Compass,
      title: "Let's take a quick tour",
      body: "We'll step through each tab so you know where everything lives. You can go back, skip, or close at any time.",
    },
    {
      icon: Factory,
      title: "Run",
      body: "Set up the current run (brand, flavor, cases) and track live progress, timing, and stoppages.",
      tab: "run",
    },
    {
      icon: Layers,
      title: "Dough / Crusts",
      body: "See how many dough batches or crust trays you need and when to start the next batch.",
      tab: "dough",
    },
    {
      icon: Droplets,
      title: "Sauce",
      body: "Sauce batches and barrels required for the run.",
      tab: "sauce",
    },
    {
      icon: ListChecks,
      title: "Frontline",
      body: "Cheese, applicators, and pepperoni amounts for the line.",
      tab: "frontline",
    },
    {
      icon: Package,
      title: "Packaging",
      body: "Circles, shippers, and cartons needed to pack the run.",
      tab: "packaging",
    },
    {
      icon: Warehouse,
      title: "Warehouse",
      body: "Finished-goods roll-up: pizzas, cases, and pallets produced.",
      tab: "warehouse",
    },
    {
      icon: MoreHorizontal,
      title: "More in the menu",
      body: isManager
        ? "Open the top-right menu for Stoppages & Summary, Inventory, the AI Assistant, Schedule, Setup & Settings, Reported issues, and Report an issue."
        : "Open the top-right menu for Stoppages & Summary, Inventory, the AI Assistant, Schedule, Setup & Settings, and Report an issue.",
    },
  ];
  return steps;
}

export default function GuidedTour({
  open,
  onClose,
  onComplete,
  onNavigate,
  isManager,
}: {
  open: boolean;
  onClose: () => void;
  // Fired when the user reaches the final step and taps "Done", so the caller
  // can record that this user finished the tour. Skipping/closing won't fire it.
  onComplete?: () => void;
  // Switch the underlying app to a given tab as tour steps advance.
  onNavigate: (tab: string) => void;
  isManager: boolean;
}) {
  const steps = buildSteps(isManager);
  const [index, setIndex] = useState(0);
  const dialogRef = useAccessibleDialog<HTMLDivElement>(open, onClose);

  // Reset to the first step every time the tour is opened.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Switch the underlying tab whenever the active step targets one.
  useEffect(() => {
    if (!open) return;
    const tab = steps[index]?.tab;
    if (tab) onNavigate(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  if (!open) return null;

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const Icon = step.icon;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="guided-tour-dialog-title" className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="guided-tour-dialog-title" className="text-base font-bold text-foreground">{step.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {index + 1} / {steps.length}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {isFirst ? (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Skip
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          )}
          {isLast ? (
            <Button
              size="sm"
              onClick={() => {
                onComplete?.();
                onClose();
              }}
            >
              <Check className="mr-1 h-4 w-4" /> Done
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}>
              Next <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
