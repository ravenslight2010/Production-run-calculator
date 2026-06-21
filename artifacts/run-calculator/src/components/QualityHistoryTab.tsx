import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ImageOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchQualityChecks,
  type QualityCheckRecord,
  type QualityProductType,
  type QualityStatus,
} from "../inventoryShared";
import { useMe } from "../useRole";

type ProductFilter = "all" | QualityProductType;
type StatusFilter = "all" | QualityStatus;

const STATUS_META: Record<
  QualityStatus,
  { label: string; cls: string; dot: string; icon: typeof CheckCircle2 }
> = {
  pass: {
    label: "Looks good",
    cls: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10",
    dot: "bg-emerald-500",
    icon: CheckCircle2,
  },
  warn: {
    label: "Minor issues",
    cls: "text-amber-500 border-amber-500/40 bg-amber-500/10",
    dot: "bg-amber-500",
    icon: AlertTriangle,
  },
  fail: {
    label: "Defects found",
    cls: "text-red-500 border-red-500/40 bg-red-500/10",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
};

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function QualityRow({ check }: { check: QualityCheckRecord }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[check.status];
  const StatusIcon = meta.icon;
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-3 text-left"
      >
        {check.thumbnail ? (
          <img
            src={check.thumbnail}
            alt="Quality check"
            className="w-12 h-12 rounded-md object-cover shrink-0 border border-border"
          />
        ) : (
          <span className="w-12 h-12 rounded-md shrink-0 border border-border bg-muted/40 flex items-center justify-center text-muted-foreground">
            <ImageOff className="w-4 h-4" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground capitalize">
              {check.productType}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}
            >
              <StatusIcon className="w-3 h-3" /> {meta.label}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {Math.round(check.confidence * 100)}% conf.
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {formatWhen(check.createdAt)}
            {check.reviewerName ? ` · ${check.reviewerName}` : ""}
            {check.issues.length > 0
              ? ` · ${check.issues.length} issue${check.issues.length === 1 ? "" : "s"}`
              : ""}
          </div>
          {check.summary && (
            <p className="text-xs text-foreground/80 mt-1 line-clamp-2">{check.summary}</p>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/60">
          {check.thumbnail && (
            <img
              src={check.thumbnail}
              alt="Quality check"
              className="mt-3 w-full max-h-64 rounded-md object-contain bg-muted/30 border border-border"
            />
          )}
          {check.summary && <p className="text-xs text-foreground/80 mt-2">{check.summary}</p>}
          {check.issues.length > 0 && (
            <ul className="space-y-1.5 mt-1">
              {check.issues.map((issue, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs rounded-md border border-border/60 bg-muted/30 p-2"
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
                  <span>
                    <span className="font-semibold capitalize">{issue.type}</span>{" "}
                    <span className="text-muted-foreground">({issue.severity})</span> —{" "}
                    {issue.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {check.notes && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold">Context:</span> {check.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function QualityHistoryTab() {
  const { hasCapability } = useMe();
  const canUseAiTools = hasCapability("use-ai-tools");
  const [product, setProduct] = useState<ProductFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const query = useQuery({
    queryKey: ["qualityChecks", product, status],
    enabled: canUseAiTools,
    queryFn: () =>
      fetchQualityChecks({
        productType: product === "all" ? undefined : product,
        status: status === "all" ? undefined : status,
      }),
  });

  if (!canUseAiTools) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center">
        <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          Quality history is available to managers only.
        </p>
      </div>
    );
  }

  const checks = query.data ?? [];

  return (
    <div className="max-w-2xl mx-auto px-3 py-4 pb-24 space-y-4">
      <Card className="bg-card/50 border-border/50 shadow-md">
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> Quality History
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Every quality check a manager reviews and confirms is logged here so you can spot
            trends (e.g. recurring undersized crusts) and audit outcomes over time.
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-muted-foreground mr-1">Product:</span>
              {(["all", "pizza", "crust", "other"] as ProductFilter[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProduct(p)}
                  className={`h-7 px-2.5 rounded-md border text-xs font-semibold capitalize transition-colors ${
                    product === p
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-muted-foreground mr-1">Status:</span>
              {(["all", "pass", "warn", "fail"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`h-7 px-2.5 rounded-md border text-xs font-semibold capitalize transition-colors ${
                    status === s
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {s === "all" ? "all" : STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-red-500 text-center py-6">
          Couldn't load quality history. Please try again.
        </p>
      ) : checks.length === 0 ? (
        <div className="text-center py-10">
          <ShieldCheck className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            No quality checks recorded yet. Run a check from the Stock tab and confirm the outcome
            to start the history.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {checks.map((check) => (
            <QualityRow key={check.id} check={check} />
          ))}
        </div>
      )}
    </div>
  );
}
