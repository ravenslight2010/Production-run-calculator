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
  Mic,
  Volume2,
  VolumeX,
  CalendarClock,
  CalendarPlus,
  ChefHat,
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
import { requestCommand, commandErrorMessage } from "../aiCommand";
import type { VoiceCommandAction, VoiceCommandResult } from "@workspace/voice-commands";
import { useSpeechInput } from "../useSpeechInput";
import { useSpeechOutput } from "../useSpeechOutput";
import {
  type RecipeAssistInput,
  type RecipeAssistSuggestion,
  requestRecipeAssist,
  recipeAssistErrorMessage,
} from "../aiRecipe";
import {
  type ForecastInput,
  type ForecastPlan,
  type ForecastConfidence,
  type ForecastAccuracyInput,
  type ForecastAccuracyReview,
  type ForecastAccuracyProductStatus,
  requestForecast,
  requestForecastAccuracy,
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

// One executed voice-command result, with a short Undo window. The command has
// ALREADY run (voice commands apply immediately — Undo is the safety net), so
// this only confirms what happened and offers to revert it. Mirrors the undo
// timer pattern used by SuggestionCard / RecCard.
function VoiceResultRow({ result }: { result: VoiceCommandResult }) {
  const [undo, setUndo] = useState<(() => void | Promise<void>) | null>(() =>
    result.ok && result.undo ? result.undo : null,
  );
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (result.ok && result.undo) {
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    }
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [result]);

  function handleUndo() {
    if (undo) void undo();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
        result.ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/30 bg-red-500/10 text-red-300"
      }`}
      data-testid="voice-command-result"
    >
      {result.ok ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{result.label}</p>
        <p className="text-[11px] opacity-90">{result.message}</p>
      </div>
      {undo && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 gap-1 px-2 text-[11px]"
          onClick={handleUndo}
          data-testid="button-undo-voice-command"
        >
          <Undo2 className="h-3 w-3" />
          Undo
        </Button>
      )}
    </div>
  );
}

// Free-form "ask the AI about the day" chat. Available to every signed-in
// worker (not manager-gated). Answers are grounded strictly in the day's real
// data; the server keeps per-user follow-up memory and returns the updated
// conversation window on each reply, which we render as the thread.
//
// The mic does double duty: a spoken phrase is sent to /ai/command, which
// classifies it as a QUESTION (routed through the unchanged ask flow) or a
// COMMAND (dispatched immediately through the app's existing mutations, with an
// Undo safety net). Typed input always goes through the ask flow as before.
function AskChat({
  buildInput,
  onApplyVoiceCommand,
}: {
  buildInput: () => OptimizeInput;
  onApplyVoiceCommand: (actions: VoiceCommandAction[]) => Promise<VoiceCommandResult[]>;
}) {
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResults, setVoiceResults] = useState<VoiceCommandResult[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Voice input: a FINAL transcript is sent to /ai/command, which decides whether
  // it's a question (routed through the unchanged ask flow) or a command
  // (dispatched immediately through existing mutations). Interim transcripts just
  // preview in the box. Falls back to plain typing when speech isn't supported.
  const { supported: micSupported, listening, state: micState, toggle: toggleMic } =
    useSpeechInput({
      onTranscript: (text, isFinal) => {
        setQuestion(text);
        if (isFinal) void handleVoice(text);
      },
    });
  const micDenied = micState === "denied";

  // Voice output: when enabled, the newest AI reply is read aloud so a worker
  // with full hands can hear the answer — completing the hands-free loop after
  // a spoken question. Only the latest assistant turn is narrated; replies are
  // already on screen, so this changes nothing about the answer itself. Hidden
  // when SpeechSynthesis isn't available (graceful fallback to reading).
  const { supported: ttsSupported, speaking, speak, cancel: cancelSpeech } = useSpeechOutput();
  const [speakAnswers, setSpeakAnswers] = useState(false);
  // Index of the last assistant turn we've narrated, so re-renders don't repeat.
  const lastSpokenRef = useRef(-1);

  useEffect(() => {
    if (!speakAnswers || !ttsSupported) return;
    let idx = -1;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].role !== "user") {
        idx = i;
        break;
      }
    }
    if (idx >= 0 && idx !== lastSpokenRef.current) {
      lastSpokenRef.current = idx;
      speak(turns[idx].text);
    }
  }, [turns, speakAnswers, ttsSupported, speak]);

  function toggleSpeak() {
    if (!ttsSupported) return;
    if (speakAnswers) {
      setSpeakAnswers(false);
      cancelSpeech();
    } else {
      // Re-read the current latest reply when (re)enabling.
      lastSpokenRef.current = -1;
      setSpeakAnswers(true);
    }
  }

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

  async function sendQuestion(raw: string) {
    const q = raw.trim();
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

  function send() {
    void sendQuestion(question);
  }

  // A finished spoken phrase: classify it server-side, then either route it
  // through the unchanged ask flow (question) or dispatch the resolved actions
  // immediately (command). "none" leaves the transcript in the box so the user
  // can edit and send it as a question manually.
  async function handleVoice(utterance: string) {
    const u = utterance.trim();
    if (!u || voiceBusy || loading) return;
    setVoiceBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await requestCommand(u, buildInput());
      if (res.type === "question") {
        await sendQuestion(u);
      } else if (res.type === "command") {
        const results = await onApplyVoiceCommand(res.actions);
        setVoiceResults((prev) => [...prev, ...results]);
        setQuestion("");
      } else {
        setNote(res.note || "I didn't catch a question or command in that.");
      }
    } catch (e) {
      setError(commandErrorMessage(e));
    } finally {
      setVoiceBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
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

        {voiceResults.length > 0 && (
          <div className="space-y-1.5" data-testid="voice-command-results">
            {voiceResults.map((r, i) => (
              <VoiceResultRow key={`${i}-${r.kind}`} result={r} />
            ))}
          </div>
        )}

        {voiceBusy && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working on that…
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              listening ? "Listening…" : "Ask a question, or say a command (e.g. start a stoppage)…"
            }
            rows={2}
            className="min-h-[44px] resize-none"
            disabled={loading || voiceBusy}
            data-testid="input-ask-question"
          />
          {micSupported && (
            <Button
              type="button"
              variant={listening ? "default" : "outline"}
              size="icon"
              onClick={toggleMic}
              disabled={loading || voiceBusy}
              className={`shrink-0 ${listening ? "animate-pulse" : ""}`}
              aria-label={listening ? "Stop voice input" : "Speak a question or command"}
              title={listening ? "Stop voice input" : "Speak a question or command"}
              data-testid="button-ask-mic"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
          {ttsSupported && (
            <Button
              type="button"
              variant={speakAnswers ? "default" : "outline"}
              size="icon"
              onClick={toggleSpeak}
              className={`shrink-0 ${speakAnswers && speaking ? "animate-pulse" : ""}`}
              aria-pressed={speakAnswers}
              aria-label={speakAnswers ? "Stop reading answers aloud" : "Read answers aloud"}
              title={speakAnswers ? "Stop reading answers aloud" : "Read answers aloud"}
              data-testid="button-ask-speak"
            >
              {speakAnswers ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
          )}
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
        {micDenied && (
          <p className="text-[11px] text-muted-foreground" data-testid="ask-mic-denied">
            Microphone access is blocked. Allow it in your browser, or just type your question.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// A confirm-first, one-tap apply for a structured recipe suggestion (a scaled
// recipe or a substitution). Nothing changes until the worker taps Apply; the
// rows are shown first so they confirm exactly what they're applying. After
// applying, a short Undo window restores the previous rows. Mirrors RecCard.
function SuggestionCard({
  suggestion,
  onApply,
}: {
  suggestion: RecipeAssistSuggestion;
  onApply: (s: RecipeAssistSuggestion) => { ok: boolean; message: string; undo?: () => void };
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
    const result = onApply(suggestion);
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

  const label =
    suggestion.summary?.trim() ||
    (suggestion.kind === "scale" ? "Apply scaled recipe" : "Apply substitution");
  const title = suggestion.recipeName?.trim();

  return (
    <div
      className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5"
      data-testid="recipe-assist-suggestion"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary/80">
        <Sparkles className="h-3.5 w-3.5" />
        {suggestion.kind === "scale" ? "Scaled recipe" : "Substitution"}
      </div>
      {title && <p className="mt-1 text-xs font-medium text-foreground">{title}</p>}
      <ul className="mt-1.5 space-y-0.5">
        {suggestion.rows.map((r, idx) => (
          <li
            key={idx}
            className="flex justify-between gap-3 text-[11px] text-muted-foreground"
          >
            <span className="truncate">{r.ingredient}</span>
            <span className="shrink-0 font-mono">{r.lbs} lbs</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={applied?.ok ? "secondary" : "default"}
          className="h-7 gap-1.5 text-xs"
          onClick={handleApply}
          disabled={applied?.ok}
          data-testid="button-apply-recipe-suggestion"
        >
          {applied?.ok ? <Check className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
          {applied?.ok ? "Applied" : label}
        </Button>
        {undo && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={handleUndo}
            data-testid="button-undo-recipe-suggestion"
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
    </div>
  );
}

// Recipe & ingredient helper. A single-shot Q&A (no follow-up memory) over the
// current run's real recipes: scale a recipe, suggest a substitution, or explain
// a formula in plain language. Available to every signed-in worker (not manager-
// gated), exactly like AskChat. For a scale/substitute question the assistant may
// also return a structured suggestion the worker can apply in one tap (confirm-
// first via SuggestionCard) — the AI never edits a recipe on its own.
function RecipeAssistChat({
  buildContext,
  onApplySuggestion,
}: {
  buildContext: () => Omit<RecipeAssistInput, "question">;
  onApplySuggestion: (
    s: RecipeAssistSuggestion,
  ) => { ok: boolean; message: string; undo?: () => void };
}) {
  const [turns, setTurns] = useState<
    { role: "user" | "assistant"; text: string; suggestion?: RecipeAssistSuggestion }[]
  >([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    setTurns([...turns, { role: "user", text: q }]);
    setQuestion("");
    try {
      const ctx = buildContext();
      const res = await requestRecipeAssist({ ...ctx, question: q });
      setTurns((cur) => [
        ...cur,
        { role: "assistant", text: res.answer, suggestion: res.suggestion },
      ]);
      if (res.note) setNote(res.note);
    } catch (e) {
      setTurns(prevTurns);
      setQuestion(q);
      setError(recipeAssistErrorMessage(e));
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
          <ChefHat className="w-5 h-5 text-primary" />
          Recipe &amp; ingredient helper
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ask about this run&apos;s recipes — e.g. &ldquo;scale the dough recipe to 1.5x&rdquo;,
          &ldquo;what can I substitute for X?&rdquo;, or &ldquo;explain how the dough batch is
          figured&rdquo;. Answers use only your real recipe data. Advisory only — nothing is changed.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          ref={scrollRef}
          className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border bg-card/40 p-3"
          data-testid="recipe-assist-thread"
        >
          {turns.length === 0 && !loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No questions yet. Ask anything about your recipes or ingredients.
            </p>
          ) : (
            turns.map((t, i) => (
              <div
                key={i}
                className={`flex flex-col ${t.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    t.role === "user"
                      ? "bg-primary/15 text-foreground"
                      : "bg-muted text-foreground"
                  }`}
                  data-testid={`recipe-assist-turn-${t.role}`}
                >
                  {t.text}
                </div>
                {t.role === "assistant" && t.suggestion && (
                  <div className="w-[85%]">
                    <SuggestionCard suggestion={t.suggestion} onApply={onApplySuggestion} />
                  </div>
                )}
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
            placeholder="Ask about a recipe or ingredient…"
            rows={2}
            className="min-h-[44px] resize-none"
            disabled={loading}
            data-testid="input-recipe-assist-question"
          />
          <Button
            onClick={() => void send()}
            disabled={loading || !question.trim()}
            className="gap-1.5"
            data-testid="button-recipe-assist-send"
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

// Tomorrow as a local YYYY-MM-DD string — the default forecast target and the
// earliest day the manager may forecast (forecasting today or the past makes no
// sense). Kept in lockstep with the mobile tomorrowStr() (replit.md parity).
function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Manager-only demand forecast. Predicts an upcoming day's run plan grounded in
// real history; advisory only. The manager picks the target day (defaults to
// tomorrow) then taps "Add to schedule" to review the suggestion in the editable
// schedule editor — nothing is committed here.
function ForecastSection({
  buildForecast,
  onApplyForecast,
}: {
  buildForecast: (targetDate: string) => ForecastInput;
  onApplyForecast: (plan: ForecastPlan) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { forecast: ForecastPlan | null; note?: string; generatedAt: number } | null
  >(null);
  const [applied, setApplied] = useState(false);
  const [targetDate, setTargetDate] = useState(tomorrowStr());

  async function predict() {
    setLoading(true);
    setError(null);
    setApplied(false);
    try {
      const res = await requestForecast(buildForecast(targetDate || tomorrowStr()));
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
            Predict an upcoming day&apos;s run plan from recent production history — what to run,
            rough quantities, and a sensible order. Advisory only; you review and adjust it in the
            schedule before anything is planned.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="forecast-target-date"
              className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Forecast day
            </label>
            <input
              id="forecast-target-date"
              type="date"
              value={targetDate}
              min={tomorrowStr()}
              onChange={(e) => setTargetDate(e.target.value)}
              className="h-9 w-full rounded-md border border-border/60 bg-muted/40 px-3 text-sm outline-none transition-colors focus:border-primary/60"
              data-testid="input-forecast-date"
            />
          </div>
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
                <CalendarClock className="w-4 h-4" /> Forecast {formatTargetDate(targetDate || tomorrowStr())}
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

function accuracyStatusClass(s: ForecastAccuracyProductStatus): string {
  if (s === "hit") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (s === "missed" || s === "unexpected")
    return "bg-red-500/15 text-red-400 border-red-500/30";
  return "bg-amber-500/15 text-amber-400 border-amber-500/30";
}

const ACCURACY_STATUS_LABEL: Record<ForecastAccuracyProductStatus, string> = {
  hit: "on target",
  over: "over-predicted",
  under: "under-predicted",
  missed: "not run",
  unexpected: "unplanned",
};

function accuracyPctClass(pct: number): string {
  if (pct >= 85) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (pct >= 60) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-red-500/15 text-red-400 border-red-500/30";
}

// Manager-only forecast accuracy. After a forecasted day finishes, compares what
// the forecast predicted against the actual finished runs. Read-only — no AI call,
// nothing committed; purely a hindsight signal so managers can calibrate trust.
function AccuracySection({
  buildAccuracy,
}: {
  buildAccuracy: () => ForecastAccuracyInput;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { reviews: ForecastAccuracyReview[]; note?: string; generatedAt: number } | null
  >(null);

  async function review() {
    setLoading(true);
    setError(null);
    try {
      const res = await requestForecastAccuracy(buildAccuracy());
      setResult(res);
    } catch (e) {
      setError(forecastErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const reviews = result?.reviews ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-primary" />
            Forecast Accuracy
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            See how past demand forecasts held up against what actually ran. Compares each
            forecasted day&apos;s predicted brands, flavors, and cases to the finished runs so you
            can calibrate how much to trust upcoming forecasts.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={review}
            disabled={loading}
            className="gap-2"
            data-testid="button-forecast-accuracy"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Checking…
              </>
            ) : result ? (
              <>
                <RefreshCw className="w-4 h-4" /> Re-check accuracy
              </>
            ) : (
              <>
                <Gauge className="w-4 h-4" /> Check past accuracy
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

      {result && reviews.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Gauge className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">No forecasts to score yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {result.note ??
                "Once a day you forecasted has finished its runs, its accuracy will show up here."}
            </p>
          </CardContent>
        </Card>
      )}

      {reviews.map((rev) => (
        <Card key={rev.date} data-testid={`accuracy-review-${rev.date}`}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="w-4 h-4 text-primary" />
                {formatTargetDate(rev.date)}
              </CardTitle>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accuracyPctClass(rev.caseAccuracyPct)}`}
                data-testid={`accuracy-pct-${rev.date}`}
              >
                {rev.caseAccuracyPct}% accurate
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Predicted {rev.predictedTotalCases} cs · Actual {rev.actualTotalCases} cs ·{" "}
              {rev.confidence} confidence at forecast time
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {rev.products.map((p, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{p.label}</p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accuracyStatusClass(p.status)}`}
                  >
                    {ACCURACY_STATUS_LABEL[p.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                  Predicted {p.predictedCases} cs · Actual {p.actualCases} cs
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

export default function AssistantTab({
  buildInput,
  buildRecipeContext,
  onApplyRecipeSuggestion,
  onApplyAction,
  onApplyVoiceCommand,
  buildForecast,
  onApplyForecast,
  buildAccuracy,
}: {
  buildInput: () => OptimizeInput;
  buildRecipeContext: () => Omit<RecipeAssistInput, "question">;
  onApplyRecipeSuggestion: (
    s: RecipeAssistSuggestion,
  ) => { ok: boolean; message: string; undo?: () => void };
  onApplyAction: (action: OptimizeAction) => { ok: boolean; message: string };
  onApplyVoiceCommand: (actions: VoiceCommandAction[]) => Promise<VoiceCommandResult[]>;
  buildForecast: (targetDate: string) => ForecastInput;
  onApplyForecast: (plan: ForecastPlan) => void;
  buildAccuracy: () => ForecastAccuracyInput;
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
      <AskChat buildInput={buildInput} onApplyVoiceCommand={onApplyVoiceCommand} />

      <RecipeAssistChat
        buildContext={buildRecipeContext}
        onApplySuggestion={onApplyRecipeSuggestion}
      />

      {!isManager ? null : (
      <>
      <ForecastSection buildForecast={buildForecast} onApplyForecast={onApplyForecast} />

      <AccuracySection buildAccuracy={buildAccuracy} />

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
