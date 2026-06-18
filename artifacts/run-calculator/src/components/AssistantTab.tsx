import { useState } from "react";
import {
  Sparkles,
  Loader2,
  Gauge,
  Coffee,
  TrendingUp,
  Lock,
  AlertTriangle,
  RefreshCw,
  Check,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  type OptimizeInput,
  type OptimizeRecommendation,
  type OptimizeCategory,
  type OptimizeImpact,
  type OptimizeAction,
  requestOptimize,
  optimizeErrorMessage,
} from "../aiOptimize";
import { useMe } from "../useRole";

const CATEGORY_META: Record<
  OptimizeCategory,
  { label: string; icon: typeof Gauge; desc: string }
> = {
  run: { label: "Run Optimization", icon: Gauge, desc: "Sequencing, pacing, and catching up to plan" },
  break: { label: "Break Optimization", icon: Coffee, desc: "When breaks land without stalling the line" },
  efficiency: { label: "Efficiency & Insights", icon: TrendingUp, desc: "Downtime, throughput, and trends" },
};

const CATEGORY_ORDER: OptimizeCategory[] = ["run", "break", "efficiency"];

function impactClass(impact: OptimizeImpact): string {
  if (impact === "high") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (impact === "medium") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-sky-500/15 text-sky-400 border-sky-500/30";
}

function RecCard({
  rec,
  onApply,
}: {
  rec: OptimizeRecommendation;
  onApply: (action: OptimizeAction) => { ok: boolean; message: string };
}) {
  const [applied, setApplied] = useState<{ ok: boolean; message: string } | null>(null);

  function handleApply() {
    if (!rec.action) return;
    const result = onApply(rec.action);
    setApplied(result);
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{rec.title}</p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${impactClass(rec.impact)}`}
        >
          {rec.impact}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rec.detail}</p>
      {rec.appliesTo && (
        <p className="mt-1.5 text-[11px] font-medium text-primary/80">{rec.appliesTo}</p>
      )}
      {rec.action && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={applied?.ok ? "secondary" : "default"}
            className="h-7 gap-1.5 text-xs"
            onClick={handleApply}
            disabled={applied?.ok}
            data-testid="button-apply-action"
          >
            {applied?.ok ? <Check className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
            {applied?.ok ? "Applied" : rec.action.label}
          </Button>
          {applied && (
            <span
              className={`text-[11px] font-medium ${applied.ok ? "text-emerald-400" : "text-red-400"}`}
            >
              {applied.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function AssistantTab({
  buildInput,
  onApplyAction,
}: {
  buildInput: () => OptimizeInput;
  onApplyAction: (action: OptimizeAction) => { ok: boolean; message: string };
}) {
  const { isManager, isLoading: roleLoading } = useMe();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { recommendations: OptimizeRecommendation[]; note?: string; generatedAt: number } | null
  >(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const input = buildInput();
      const res = await requestOptimize(input);
      setResult(res);
    } catch (e) {
      setError(optimizeErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!isManager) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Lock className="w-6 h-6 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Managers only</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            The AI assistant is available to managers. Ask a manager to review optimization
            recommendations.
          </p>
        </CardContent>
      </Card>
    );
  }

  const grouped = (cat: OptimizeCategory) =>
    (result?.recommendations ?? []).filter((r) => r.category === cat);

  const hasRecs = (result?.recommendations.length ?? 0) > 0;

  return (
    <div className="space-y-4 pb-24">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI Assistant
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Analyze today&apos;s runs, the schedule, and recent history for run sequencing, break
            timing, and efficiency recommendations. Advisory only — nothing is applied
            automatically.
          </p>
          <Button onClick={analyze} disabled={loading} className="gap-2">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Analyzing…
              </>
            ) : result ? (
              <>
                <RefreshCw className="w-4 h-4" /> Re-analyze
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Analyze shift
              </>
            )}
          </Button>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {result && !hasRecs && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Sparkles className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">No recommendations yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {result.note ??
                "There isn't enough run data to analyze yet. Start a run and try again once production is underway."}
            </p>
          </CardContent>
        </Card>
      )}

      {result &&
        hasRecs &&
        CATEGORY_ORDER.map((cat) => {
          const recs = grouped(cat);
          if (recs.length === 0) return null;
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          return (
            <Card key={cat}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="w-4 h-4 text-primary" />
                  {meta.label}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{meta.desc}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {recs.map((r, i) => (
                  <RecCard key={i} rec={r} onApply={onApplyAction} />
                ))}
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
