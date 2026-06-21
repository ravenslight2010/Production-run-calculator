import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Loader2,
  Gauge,
  Coffee,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Check,
  Zap,
  Undo2,
  MessageCircle,
  Send,
  CalendarClock,
  CalendarPlus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type OptimizeInput,
  type OptimizeRecommendation,
  type OptimizeCategory,
  type OptimizeImpact,
  type OptimizeAction,
  requestOptimize,
  optimizeErrorMessage,
} from "../aiOptimize";
import { requestAsk, askErrorMessage } from "../aiAsk";
import {
  type ForecastInput,
  type ForecastPlan,
  type ForecastConfidence,
  requestForecast,
  forecastErrorMessage,
} from "../aiForecast";
import { fetchConversationHistory, type ConversationTurn } from "../aiMemory";
import { useMe } from "../useRole";
import ReviewBadge from "./ReviewBadge";

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

const UNDO_WINDOW_MS = 6000;

function RecCard({
  rec,
  onApply,
}: {
  rec: OptimizeRecommendation;
  onApply: (action: OptimizeAction) => { ok: boolean; message: string; undo?: () => void };
}) {
  const [applied, setApplied] = useState<{ ok: boolean; message: string } | null>(null);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  function clearUndoTimer() {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  }

  function handleApply() {
    if (!rec.action) return;
    const result = onApply(rec.action);
    setApplied(result);
    if (result.ok && result.undo) {
      const fn = result.undo;
      setUndo(() => fn);
      clearUndoTimer();
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    }
  }

  function handleUndo() {
    if (undo) undo();
    clearUndoTimer();
    setUndo(null);
    setApplied(null);
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
      {rec.review && <ReviewBadge review={rec.review} className="mt-2" />}
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
          {undo && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs"
              onClick={handleUndo}
              data-testid="button-undo-action"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </Button>
          )}
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

// Free-form "ask the AI about the day" chat. Available to every signed-in
// worker (not manager-gated). Answers are grounded strictly in the day's real
// data; the server keeps per-user follow-up memory and returns the updated
// conversation window on each reply, which we render as the thread.
function AskChat({ buildInput }: { buildInput: () => OptimizeInput }) {
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load this user's prior conversation on mount (best-effort).
  useEffect(() => {
    let cancelled = false;
    fetchConversationHistory()
      .then((t) => {
        if (!cancelled) setTurns(t);
      })
      .catch(() => {
        /* treat as empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, loading]);

  async function send() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setNote(null);
    const prevTurns = turns;
    // Optimistically show the question; server truth replaces it on reply.
    setTurns([...turns, { role: "user", text: q }]);
    setQuestion("");
    try {
      const res = await requestAsk(q, buildInput());
      if (res.turns.length) setTurns(res.turns);
      if (res.note) setNote(res.note);
    } catch (e) {
      setTurns(prevTurns);
      setQuestion(q);
      setError(askErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          Ask about the day
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ask a plain-language question about today&apos;s runs, the schedule, and recent history —
          e.g. &ldquo;can we finish by 2pm?&rdquo;. Answers come only from real data.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          ref={scrollRef}
          className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border bg-card/40 p-3"
          data-testid="ask-thread"
        >
          {turns.length === 0 && !loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No questions yet. Ask anything about today&apos;s production.
            </p>
          ) : (
            turns.map((t, i) => (
              <div
                key={i}
                className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    t.role === "user"
                      ? "bg-primary/15 text-foreground"
                      : "bg-muted text-foreground"
                  }`}
                  data-testid={`ask-turn-${t.role}`}
                >
                  {t.text}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>

        {note && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{note}</span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about today's runs…"
            rows={2}
            className="min-h-[44px] resize-none"
            disabled={loading}
            data-testid="input-ask-question"
          />
          <Button
            onClick={() => void send()}
            disabled={loading || !question.trim()}
            className="gap-1.5"
            data-testid="button-ask-send"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function confidenceClass(c: ForecastConfidence): string {
  if (c === "high") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (c === "low") return "bg-red-500/15 text-red-400 border-red-500/30";
  return "bg-amber-500/15 text-amber-400 border-amber-500/30";
}

function formatTargetDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// Manager-only demand forecast. Predicts an upcoming day's run plan grounded in
// real history; advisory only. The manager taps "Add to schedule" to review the
// suggestion in the editable schedule editor — nothing is committed here.
function ForecastSection({
  buildForecast,
  onApplyForecast,
}: {
  buildForecast: () => ForecastInput;
  onApplyForecast: (plan: ForecastPlan) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { forecast: ForecastPlan | null; note?: string; generatedAt: number } | null
  >(null);
  const [applied, setApplied] = useState(false);

  async function predict() {
    setLoading(true);
    setError(null);
    setApplied(false);
    try {
      const res = await requestForecast(buildForecast());
      setResult(res);
    } catch (e) {
      setError(forecastErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const plan = result?.forecast ?? null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            Demand Forecast
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Predict tomorrow&apos;s run plan from recent production history — what to run, rough
            quantities, and a sensible order. Advisory only; you review and adjust it in the
            schedule before anything is planned.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={predict} disabled={loading} className="gap-2" data-testid="button-forecast">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Forecasting…
              </>
            ) : result ? (
              <>
                <RefreshCw className="w-4 h-4" /> Re-forecast
              </>
            ) : (
              <>
                <CalendarClock className="w-4 h-4" /> Forecast tomorrow
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

      {result && !plan && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <CalendarClock className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">No forecast yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {result.note ??
                "There isn't enough production history to forecast responsibly yet. Finish a few days of runs and try again."}
            </p>
          </CardContent>
        </Card>
      )}

      {plan && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="w-4 h-4 text-primary" />
                Plan for {formatTargetDate(plan.targetDate)}
              </CardTitle>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${confidenceClass(plan.confidence)}`}
                data-testid="forecast-confidence"
              >
                {plan.confidence} confidence
              </span>
            </div>
            {plan.summary && (
              <p className="text-xs leading-relaxed text-muted-foreground">{plan.summary}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {plan.runs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {r.brand}
                    {r.flavor ? ` · ${r.flavor}` : ""}
                  </p>
                  <span className="shrink-0 text-xs font-bold text-primary">
                    {r.casesNeeded > 0 ? `${r.casesNeeded} cs` : "—"}
                  </span>
                </div>
                {r.dieType && (
                  <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                    Die: {r.dieType}
                  </p>
                )}
                {r.rationale && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.rationale}</p>
                )}
              </div>
            ))}
            {result?.note && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{result.note}</span>
              </div>
            )}
            <Button
              variant={applied ? "secondary" : "default"}
              className="mt-1 w-full gap-2"
              disabled={applied}
              onClick={() => {
                onApplyForecast(plan);
                setApplied(true);
              }}
              data-testid="button-apply-forecast"
            >
              {applied ? <Check className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
              {applied ? "Opened in schedule" : "Add to schedule"}
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function AssistantTab({
  buildInput,
  onApplyAction,
  buildForecast,
  onApplyForecast,
}: {
  buildInput: () => OptimizeInput;
  onApplyAction: (action: OptimizeAction) => { ok: boolean; message: string };
  buildForecast: () => ForecastInput;
  onApplyForecast: (plan: ForecastPlan) => void;
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

  const grouped = (cat: OptimizeCategory) =>
    (result?.recommendations ?? []).filter((r) => r.category === cat);

  const hasRecs = (result?.recommendations.length ?? 0) > 0;

  return (
    <div className="space-y-4 pb-24">
      <AskChat buildInput={buildInput} />

      {!isManager ? null : (
      <>
      <ForecastSection buildForecast={buildForecast} onApplyForecast={onApplyForecast} />

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
      </>
      )}
    </div>
  );
}
