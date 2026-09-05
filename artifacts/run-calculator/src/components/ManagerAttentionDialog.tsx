import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LifeBuoy,
  Settings2,
} from "lucide-react";
import { memo } from "react";
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
  actionLabel: string;
};

export type ManagerAttentionInput = {
  pendingResetCount: number;
  canApproveResets: boolean;
  unreviewedIncidentCount: number;
  canReviewIncidents: boolean;
  scheduledRecipeIssueCount: number;
  canManageProfiles: boolean;
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
      actionLabel: "Review issues",
    });
  }

  if (input.canManageProfiles && input.scheduledRecipeIssueCount > 0) {
    items.push({
      kind: "recipe-setup",
      priority: 3,
      count: input.scheduledRecipeIssueCount,
      title: "Scheduled recipe setup",
      detail: `${pluralize(input.scheduledRecipeIssueCount, "profile")} needs recipe setup before its scheduled run.`,
      actionLabel: "Set up next",
    });
  }

  return items.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
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
  authorized = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ReadonlyArray<ManagerAttentionItem>;
  onResolve: (kind: ManagerAttentionKind) => void;
  authorized?: boolean;
}) {
  // Keep the dialog out of the tree immediately when capabilities disappear.
  // This prevents a stale open state from exposing manager work during an auth
  // transition while leaving the parent hook order unchanged.
  if (!authorized) return null;
  const total = managerAttentionCount(items);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" /> Manager attention
          </DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${pluralize(total, "action")} ordered by urgency.`
              : "No manager work needs attention right now."}
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200"
            data-testid="manager-attention-empty"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" /> All caught up.
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
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80"
                  onClick={() => onResolve(item.kind)}
                  data-testid={`manager-attention-action-${item.kind}`}
                >
                  {item.actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

ManagerAttentionDialog.displayName = "ManagerAttentionDialog";

export default ManagerAttentionDialog;