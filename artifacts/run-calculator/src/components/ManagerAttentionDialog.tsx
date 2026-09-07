import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  KeyRound,
  LifeBuoy,
  ListChecks,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { memo, useEffect, useRef, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ManagerAttentionKind =
  | "password-resets"
  | "incidents"
  | "recipe-setup";

export type ManagerAttentionItem = {
  kind: ManagerAttentionKind;
  priority: number;
  count: number;
  title: string;
  detail: string;
  urgency: string;
  timing: string;
  impact: string;
  preview?: string;
  actionLabel: string;
  destination?: {
    brand?: string;
    flavor?: string;
    date?: string;
  };
};

export type ManagerAttentionSourceState = "ready" | "loading" | "stale" | "unavailable";

export type ManagerAttentionInput = {
  pendingResetCount: number;
  canApproveResets: boolean;
  unreviewedIncidentCount: number;
  canReviewIncidents: boolean;
  scheduledRecipeIssueCount: number;
  canManageProfiles: boolean;
  passwordResetState?: ManagerAttentionSourceState;
  incidentState?: ManagerAttentionSourceState;
  recipeSetupState?: ManagerAttentionSourceState;
  nextScheduledRecipeIssue?: {
    brand: string;
    flavor: string;
    dates: string[];
    totalCases: number;
    reason: "missing" | "incomplete";
  };
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

// The one authoritative manager-attention model. Only durable, actionable work
// is included here: local validation/network errors stay at their source form,
// where the person who initiated the action can correct or retry them.
export function buildManagerAttentionItems(
  input: ManagerAttentionInput,
): ManagerAttentionItem[] {
  const items: ManagerAttentionItem[] = [];

  if (input.canApproveResets && input.pendingResetCount > 0) {
    items.push({
      kind: "password-resets",
      priority: 1,
      count: input.pendingResetCount,
      title: "Password reset approvals",
      detail: `${pluralize(input.pendingResetCount, "request")} waiting for an approver.`,
      urgency: "Urgent",
      timing: "Waiting now",
      impact: "Staff may be unable to sign in.",
      actionLabel: "Review resets",
    });
  }

  if (input.canReviewIncidents && input.unreviewedIncidentCount > 0) {
    items.push({
      kind: "incidents",
      priority: 2,
      count: input.unreviewedIncidentCount,
      title: "Reported issues",
      detail: `${pluralize(input.unreviewedIncidentCount, "incident")} needs manager attention (new, assigned, or waiting).`,
      urgency: "High",
      timing: "Needs review",
      impact: "Production or support follow-up may be blocked.",
      actionLabel: "Review issues",
    });
  }

  if (input.canManageProfiles && input.scheduledRecipeIssueCount > 0) {
    const next = input.nextScheduledRecipeIssue;
    const name = next ? [next.brand, next.flavor].filter(Boolean).join(" — ") : "";
    const date = next?.dates[0];
    items.push({
      kind: "recipe-setup",
      priority: 3,
      count: input.scheduledRecipeIssueCount,
      title: "Scheduled recipe setup",
      detail: `${pluralize(input.scheduledRecipeIssueCount, "profile")} needs recipe setup before its scheduled run.`,
      urgency: "Upcoming",
      timing: date ? `Next run ${formatScheduleDate(date)}` : "Before the next scheduled run",
      impact: next?.totalCases
        ? `${pluralize(next.totalCases, "case")} cannot be planned reliably.`
        : "Scheduled production cannot be planned reliably.",
      preview: name || undefined,
      actionLabel: "Set up next",
      destination: next ? { brand: next.brand, flavor: next.flavor, date } : undefined,
    });
  }

  return items.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}

function formatScheduleDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
}

export function managerAttentionCount(items: ReadonlyArray<ManagerAttentionItem>): number {
  return items.reduce((total, item) => total + item.count, 0);
}

function AttentionIcon({ kind }: { kind: ManagerAttentionKind }) {
  const className = "h-4 w-4 shrink-0";
  switch (kind) {
    case "password-resets":
      return <KeyRound className={`${className} text-rose-400`} />;
    case "incidents":
      return <LifeBuoy className={`${className} text-amber-400`} />;
    case "recipe-setup":
      return <Settings2 className={`${className} text-sky-400`} />;
  }
}

const ManagerAttentionDialog = memo(function ManagerAttentionDialog({
  open,
  onOpenChange,
  items,
  onResolve,
  onOpenQueue,
  authorized = true,
  sourceStates = [],
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ReadonlyArray<ManagerAttentionItem>;
  onResolve: (item: ManagerAttentionItem) => void;
  onOpenQueue?: () => void;
  authorized?: boolean;
  sourceStates?: ReadonlyArray<ManagerAttentionSourceState>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const restoreFocusRef = useRef(true);
  // The parent owns `open`, so capability loss must close that state rather
  // than abruptly unmounting an open Radix portal. The effective-open guard
  // removes protected content in the same render; this effect then clears the
  // stale controlled value exactly once so access restoration cannot reopen it.
  useEffect(() => {
    if (!authorized && open) onOpenChange(false);
  }, [authorized, onOpenChange, open]);
  useEffect(() => {
    if (open) restoreFocusRef.current = true;
  }, [open]);

  const total = managerAttentionCount(items);
  const loading = sourceStates.includes("loading");
  const unavailable = sourceStates.includes("unavailable");
  const stale = sourceStates.includes("stale");
  const checkedCount = sourceStates.filter((state) => state === "ready" || state === "stale").length;

  return (
    <Dialog open={authorized && open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[88dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6"
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef.current || !returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" /> Manager attention
          </DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${pluralize(total, "action")} across ${pluralize(items.length, "category", "categories")}, ordered by urgency.`
              : loading
                ? "Checking the manager workflows you can access."
                : "No work found in the manager workflows you can access."}
          </DialogDescription>
        </DialogHeader>

        {(loading || stale || unavailable) && (
          <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="manager-attention-source-status">
            {loading && <p className="flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Still checking available workflows.</p>}
            {stale && <p className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" /> Some results are older than five minutes; shown work may have changed.</p>}
            {unavailable && <p className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> Some available workflows could not be checked. Inaccessible work is not shown.</p>}
            <p>{pluralize(checkedCount, "workflow")} checked successfully.</p>
          </div>
        )}

        {items.length === 0 && !loading && !unavailable ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200"
            data-testid="manager-attention-empty"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span><strong>All caught up.</strong> Nothing actionable was found in the workflows checked.</span>
          </div>
        ) : items.length === 0 && loading ? (
          <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-4 text-sm text-muted-foreground" data-testid="manager-attention-loading">
            Counts will appear here as each available workflow responds.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100" data-testid="manager-attention-unavailable">
            No actionable work was returned, but not every available workflow could be checked. Try again from its owning screen.
          </div>
        ) : (
          <div className="space-y-2" data-testid="manager-attention-list">
            {items.map((item) => (
              <div
                key={item.kind}
                className="rounded-lg border border-border/60 bg-card/50 px-3 py-3"
                data-testid={`manager-attention-${item.kind}`}
              >
                <div className="flex items-start gap-2">
                  <AttentionIcon kind={item.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                        {item.count}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.detail}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">{item.urgency}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{item.timing}</span>
                    </div>
                    {item.preview && <p className="mt-2 truncate text-xs font-medium" title={item.preview}>{item.preview}</p>}
                    <p className="mt-1 text-xs leading-snug text-muted-foreground"><span className="font-semibold text-foreground/80">Impact:</span> {item.impact}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80"
                  onClick={() => {
                    restoreFocusRef.current = false;
                    onResolve(item);
                  }}
                  data-testid={`manager-attention-action-${item.kind}`}
                >
                  {item.actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {onOpenQueue && (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm font-semibold hover:bg-muted/60"
            onClick={() => {
              restoreFocusRef.current = false;
              onOpenQueue();
            }}
          >
            <ListChecks className="h-4 w-4" /> Open full manager queue
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
});

ManagerAttentionDialog.displayName = "ManagerAttentionDialog";

export default ManagerAttentionDialog;