import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BarChart2,
  Boxes,
  ClipboardList,
  Droplets,
  Factory,
  Layers,
  LifeBuoy,
  ListChecks,
  Package,
  Settings,
  Sparkles,
  CalendarPlus,
  Warehouse,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Plain-language overview of the app shown automatically on a user's first
// login and reopenable any time from the header menu. The copy and structure
// are kept identical to the mobile "Get Started" modal for parity.

type Entry = { icon: LucideIcon; label: string; desc: string };

const TABS: Entry[] = [
  {
    icon: Factory,
    label: "Run",
    desc: "Set up the current run (brand, flavor, cases) and track live progress, timing, and stoppages.",
  },
  {
    icon: Layers,
    label: "Dough / Crusts",
    desc: "See how many dough batches or crust trays you need and when to start the next batch.",
  },
  {
    icon: Droplets,
    label: "Sauce",
    desc: "Sauce batches and barrels required for the run.",
  },
  {
    icon: ListChecks,
    label: "Frontline",
    desc: "Cheese, applicators, and pepperoni amounts for the line.",
  },
  {
    icon: Package,
    label: "Packaging",
    desc: "Circles, shippers, and cartons needed to pack the run.",
  },
  {
    icon: Warehouse,
    label: "Warehouse",
    desc: "Finished-goods roll-up: pizzas, cases, and pallets produced.",
  },
];

const MENU: Entry[] = [
  { icon: BarChart2, label: "Stoppages & Summary", desc: "Log downtime and review shift totals and exports." },
  { icon: ClipboardList, label: "Stock", desc: "On-hand inventory, lots, and restocks." },
  { icon: Sparkles, label: "AI Assistant", desc: "Run, break, and efficiency recommendations." },
  { icon: CalendarPlus, label: "Schedule", desc: "Plan future production days." },
  { icon: Settings, label: "Setup & Settings", desc: "Run configuration, recipes, and app options." },
  { icon: LifeBuoy, label: "Report an issue", desc: "Get instant help and alert your manager." },
];

function EntryRow({ icon: Icon, label, desc }: Entry) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

export default function GetStartedDialog({
  open,
  onOpenChange,
  onDismiss,
  isManager,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called when the user actively dismisses the overview (button or close), so
  // the caller can mark it seen. Fired once per dismissal.
  onDismiss: () => void;
  isManager: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" /> Welcome to Production Run Calculator
          </DialogTitle>
          <DialogDescription>
            Plan, run, and track your pizza production line — from dough and sauce
            to packaging and warehouse — all in one place.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              The main tabs
            </h3>
            <div className="space-y-3">
              {TABS.map((e) => (
                <EntryRow key={e.label} {...e} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              More in the menu
            </h3>
            <div className="space-y-3">
              {MENU.map((e) => (
                <EntryRow key={e.label} {...e} />
              ))}
              {isManager && (
                <EntryRow
                  icon={LifeBuoy}
                  label="Reported issues"
                  desc="Managers can review reported problems and crashes."
                />
              )}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onDismiss();
              onOpenChange(false);
            }}
          >
            Get started
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
