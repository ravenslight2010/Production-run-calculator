import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card } from "@/components/UI";
import ReviewBadge from "@/components/ReviewBadge";
import { FONTS } from "@/constants/fonts";
import { todayStr, useRun, type RunSettings } from "@/context/RunContext";
import {
  buildOptimizeInput,
  optimizeErrorMessage,
  requestOptimize,
  type OptimizeAction,
  type OptimizeCategory,
  type OptimizeImpact,
  type OptimizeInput,
  type OptimizeRecommendation,
  type OptimizeResult,
} from "@/context/aiOptimize";
import {
  buildForecastInput,
  buildForecastAccuracyInput,
  forecastErrorMessage,
  requestForecast,
  requestForecastAccuracy,
  type ForecastConfidence,
  type ForecastPlan,
  type ForecastAccuracyInput,
  type ForecastAccuracyReview,
  type ForecastAccuracyProductStatus,
} from "@/context/aiForecast";
import { askErrorMessage, requestAsk } from "@/context/aiAsk";
import {
  buildRecipeAssistContext,
  recipeAssistErrorMessage,
  requestRecipeAssist,
  RECIPE_FIELD_IDS,
  type RecipeAssistInput,
  type RecipeAssistSuggestion,
} from "@/context/aiRecipe";
import { fetchConversationHistory, type ConversationTurn } from "@/context/aiMemory";
import { requestCommand, commandErrorMessage } from "@/context/aiCommand";
import { restockInventory, adjustInventory } from "@/context/inventoryShared";
import {
  dispatchVoiceCommand,
  type VoiceCommandAction,
  type VoiceCommandHandlers,
  type VoiceCommandResult,
} from "@workspace/voice-commands";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import { useSpeechOutput } from "@/hooks/useSpeechOutput";

const CATEGORY_META: Record<
  OptimizeCategory,
  { label: string; icon: keyof typeof Feather.glyphMap; desc: string }
> = {
  run: { label: "Run Optimization", icon: "activity", desc: "Sequencing, pacing, and catching up to plan" },
  break: { label: "Break Optimization", icon: "coffee", desc: "When breaks land without stalling the line" },
  efficiency: { label: "Efficiency & Insights", icon: "trending-up", desc: "Downtime, throughput, and trends" },
};

const CATEGORY_ORDER: OptimizeCategory[] = ["run", "break", "efficiency"];

function impactColors(impact: OptimizeImpact): { bg: string; fg: string } {
  if (impact === "high") return { bg: "rgba(239,68,68,0.15)", fg: "#f87171" };
  if (impact === "medium") return { bg: "rgba(245,158,11,0.15)", fg: "#fbbf24" };
  return { bg: "rgba(14,165,233,0.15)", fg: "#38bdf8" };
}

const UNDO_WINDOW_MS = 6000;

function RecCard({
  rec,
  onApply,
}: {
  rec: OptimizeRecommendation;
  onApply: (action: OptimizeAction) => { ok: boolean; message: string; undo?: () => void };
}) {
  const colors = useColors();
  const ic = impactColors(rec.impact);
  const [applied, setApplied] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [undo, setUndo] = React.useState<(() => void) | null>(null);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

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
    <View style={[styles.recCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.recHeader}>
        <Text style={[styles.recTitle, { color: colors.foreground }]}>{rec.title}</Text>
        <View style={[styles.badge, { backgroundColor: ic.bg }]}>
          <Text style={[styles.badgeText, { color: ic.fg }]}>{rec.impact.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={[styles.recDetail, { color: colors.mutedForeground }]}>{rec.detail}</Text>
      {rec.appliesTo ? (
        <Text style={[styles.recApplies, { color: colors.primary }]}>{rec.appliesTo}</Text>
      ) : null}
      {rec.review ? (
        <View style={{ marginTop: 8 }}>
          <ReviewBadge review={rec.review} />
        </View>
      ) : null}
      {rec.action ? (
        <View style={styles.actionRow}>
          <Button
            label={applied?.ok ? "Applied" : rec.action.label}
            icon={applied?.ok ? "check" : "zap"}
            size="sm"
            variant={applied?.ok ? "outline" : "primary"}
            disabled={!!applied?.ok}
            onPress={handleApply}
          />
          {undo ? (
            <Button
              label="Undo"
              icon="rotate-ccw"
              size="sm"
              variant="outline"
              onPress={handleUndo}
            />
          ) : null}
          {applied ? (
            <Text
              style={[styles.actionMsg, { color: applied.ok ? "#34d399" : "#f87171" }]}
            >
              {applied.message}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// A short visual confirmation for ONE dispatched voice command, with an Undo
// button live for the same brief window as the rest of the assistant's apply
// actions. Mirrors the web VoiceResultRow (replit.md parity).
function VoiceResultRow({ result }: { result: VoiceCommandResult }) {
  const colors = useColors();
  const [undo, setUndo] = React.useState<(() => void | Promise<void>) | null>(() =>
    result.ok && result.undo ? result.undo : null,
  );
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
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

  const tone = result.ok
    ? { border: "rgba(16,185,129,0.3)", bg: "rgba(16,185,129,0.1)", fg: "#34d399" }
    : { border: "rgba(239,68,68,0.3)", bg: "rgba(239,68,68,0.1)", fg: "#f87171" };

  return (
    <View
      style={[styles.voiceResult, { borderColor: tone.border, backgroundColor: tone.bg }]}
      // @ts-expect-error RN web testID → data-testid for UI tests
      dataSet={{ testid: "voice-command-result" }}
    >
      <Feather
        name={result.ok ? "check" : "alert-triangle"}
        size={14}
        color={tone.fg}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.voiceResultLabel, { color: colors.foreground }]}>{result.label}</Text>
        <Text style={[styles.voiceResultMsg, { color: tone.fg }]}>{result.message}</Text>
      </View>
      {undo ? (
        <Pressable
          onPress={handleUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo voice command"
          // @ts-expect-error RN web testID → data-testid for UI tests
          dataSet={{ testid: "button-undo-voice-command" }}
          style={({ pressed }) => [
            styles.voiceUndoBtn,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="rotate-ccw" size={12} color={colors.foreground} />
          <Text style={[styles.voiceUndoText, { color: colors.foreground }]}>Undo</Text>
        </Pressable>
      ) : null}
    </View>
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
// Mirrors the web AskChat (replit.md parity).
function AskChat({
  buildInput,
  onApplyVoiceCommand,
}: {
  buildInput: () => OptimizeInput;
  onApplyVoiceCommand: (actions: VoiceCommandAction[]) => Promise<VoiceCommandResult[]>;
}) {
  const colors = useColors();
  const [turns, setTurns] = React.useState<ConversationTurn[]>([]);
  const [question, setQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = React.useState(false);
  const [voiceResults, setVoiceResults] = React.useState<VoiceCommandResult[]>([]);
  const scrollRef = React.useRef<ScrollView | null>(null);

  // Voice input: a FINAL transcript is sent to /ai/command, which decides whether
  // it's a question (routed through the unchanged ask flow) or a command
  // (dispatched immediately through existing mutations). Interim transcripts just
  // preview in the box. Falls back to plain typing when speech isn't supported
  // (e.g. native build) or the mic is denied.
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
  // when SpeechSynthesis isn't available (native build) — graceful fallback to
  // reading. Mirrors the web AskChat (replit.md parity).
  const { supported: ttsSupported, speaking, speak, cancel: cancelSpeech } = useSpeechOutput();
  const [speakAnswers, setSpeakAnswers] = React.useState(false);
  // Index of the last assistant turn we've narrated, so re-renders don't repeat.
  const lastSpokenRef = React.useRef(-1);

  React.useEffect(() => {
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
  React.useEffect(() => {
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

  React.useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
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
  // immediately (command). "none" surfaces a short note so the user can edit the
  // transcript and send it as a question manually.
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

  return (
    <Card title="Ask about the day" icon="message-circle" accent>
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>
        Ask a plain-language question about today&apos;s runs, the schedule, and recent history —
        e.g. &ldquo;can we finish by 2pm?&rdquo;. Answers come only from real data.
      </Text>
      <ScrollView
        ref={scrollRef}
        style={[styles.thread, { borderColor: colors.border, backgroundColor: colors.background }]}
        contentContainerStyle={{ gap: 8, padding: 10 }}
        nestedScrollEnabled
      >
        {turns.length === 0 && !loading ? (
          <Text style={[styles.threadEmpty, { color: colors.mutedForeground }]}>
            No questions yet. Ask anything about today&apos;s production.
          </Text>
        ) : (
          turns.map((t, i) => (
            <View
              key={i}
              style={[
                styles.bubble,
                t.role === "user"
                  ? { alignSelf: "flex-end", backgroundColor: "rgba(14,165,233,0.18)" }
                  : { alignSelf: "flex-start", backgroundColor: colors.muted },
              ]}
            >
              <Text style={[styles.bubbleText, { color: colors.foreground }]}>{t.text}</Text>
            </View>
          ))
        )}
        {loading ? (
          <View style={[styles.bubble, { alignSelf: "flex-start", backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", gap: 8 }]}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Text style={[styles.bubbleText, { color: colors.mutedForeground }]}>Thinking…</Text>
          </View>
        ) : null}
      </ScrollView>

      {note ? (
        <View style={[styles.errorBox, { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.1)" }]}>
          <Feather name="alert-triangle" size={14} color="#fbbf24" />
          <Text style={[styles.errorText, { color: "#fbbf24" }]}>{note}</Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.errorBox, { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)" }]}>
          <Feather name="alert-triangle" size={14} color="#f87171" />
          <Text style={[styles.errorText, { color: "#f87171" }]}>{error}</Text>
        </View>
      ) : null}

      {voiceResults.length > 0 ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          {voiceResults.map((r, i) => (
            <VoiceResultRow key={`${i}-${r.kind}`} result={r} />
          ))}
        </View>
      ) : null}
      {voiceBusy ? (
        <View style={[styles.bubble, { alignSelf: "flex-start", backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }]}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[styles.bubbleText, { color: colors.mutedForeground }]}>Working on that…</Text>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
          ]}
          value={question}
          onChangeText={setQuestion}
          placeholder={listening ? "Listening…" : "Ask about today's runs…"}
          placeholderTextColor={colors.mutedForeground}
          multiline
          editable={!loading && !voiceBusy}
        />
        {micSupported ? (
          <Pressable
            onPress={toggleMic}
            disabled={loading || voiceBusy}
            accessibilityRole="button"
            accessibilityLabel={listening ? "Stop voice input" : "Ask by voice"}
            style={({ pressed }) => [
              styles.micBtn,
              {
                borderColor: listening ? colors.primary : colors.border,
                backgroundColor: listening ? colors.primary : colors.background,
                opacity: loading || voiceBusy ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name="mic"
              size={18}
              color={listening ? colors.primaryForeground : colors.foreground}
            />
          </Pressable>
        ) : null}
        {ttsSupported ? (
          <Pressable
            onPress={toggleSpeak}
            accessibilityRole="button"
            accessibilityState={{ selected: speakAnswers }}
            accessibilityLabel={speakAnswers ? "Stop reading answers aloud" : "Read answers aloud"}
            style={({ pressed }) => [
              styles.micBtn,
              {
                borderColor: speakAnswers ? colors.primary : colors.border,
                backgroundColor: speakAnswers ? colors.primary : colors.background,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name={speakAnswers ? "volume-2" : "volume-x"}
              size={18}
              color={speakAnswers ? colors.primaryForeground : colors.foreground}
            />
          </Pressable>
        ) : null}
        <Button
          label="Send"
          icon="send"
          onPress={send}
          disabled={loading || voiceBusy || !question.trim()}
        />
      </View>
      {micDenied ? (
        <Text style={[styles.micDenied, { color: colors.mutedForeground }]}>
          Microphone access is blocked. Allow it in settings, or just type your question.
        </Text>
      ) : null}
    </Card>
  );
}

// A confirm-first, one-tap apply for a structured recipe suggestion (a scaled
// recipe or a substitution). Nothing changes until the worker taps Apply; the
// rows are shown first so they confirm exactly what they're applying. After
// applying, a short Undo window restores the previous rows. Mirrors the web
// SuggestionCard + RecCard (replit.md parity).
function SuggestionCard({
  suggestion,
  onApply,
}: {
  suggestion: RecipeAssistSuggestion;
  onApply: (s: RecipeAssistSuggestion) => { ok: boolean; message: string; undo?: () => void };
}) {
  const colors = useColors();
  const [applied, setApplied] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [undo, setUndo] = React.useState<(() => void) | null>(null);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

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
    <View style={[styles.suggestionCard, { backgroundColor: colors.background, borderColor: colors.primary }]}>
      <View style={styles.suggestionHeader}>
        <Feather name="zap" size={13} color={colors.primary} />
        <Text style={[styles.suggestionKind, { color: colors.primary }]}>
          {suggestion.kind === "scale" ? "SCALED RECIPE" : "SUBSTITUTION"}
        </Text>
      </View>
      {title ? (
        <Text style={[styles.suggestionTitle, { color: colors.foreground }]}>{title}</Text>
      ) : null}
      <View style={{ marginTop: 6, gap: 2 }}>
        {suggestion.rows.map((r, idx) => (
          <View key={idx} style={styles.suggestionRow}>
            <Text style={[styles.suggestionRowName, { color: colors.mutedForeground }]} numberOfLines={1}>
              {r.ingredient}
            </Text>
            <Text style={[styles.suggestionRowLbs, { color: colors.mutedForeground }]}>{r.lbs} lbs</Text>
          </View>
        ))}
      </View>
      <View style={styles.actionRow}>
        <Button
          label={applied?.ok ? "Applied" : label}
          icon={applied?.ok ? "check" : "zap"}
          size="sm"
          variant={applied?.ok ? "outline" : "primary"}
          disabled={!!applied?.ok}
          onPress={handleApply}
        />
        {undo ? (
          <Button label="Undo" icon="rotate-ccw" size="sm" variant="outline" onPress={handleUndo} />
        ) : null}
        {applied ? (
          <Text style={[styles.actionMsg, { color: applied.ok ? "#34d399" : "#f87171" }]}>
            {applied.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// Recipe & ingredient helper. Single-shot Q&A (no follow-up memory) over the
// current run's real recipes: scale a recipe, suggest a substitution, or explain
// a formula in plain language. Available to every signed-in worker (not manager-
// gated), exactly like AskChat. For a scale/substitute question the assistant may
// also return a structured suggestion the worker can apply in one tap (confirm-
// first via SuggestionCard) — the AI never edits a recipe on its own. EXACT mirror
// of the web RecipeAssistChat (replit.md parity).
function RecipeAssistChat({
  buildContext,
  onApplySuggestion,
}: {
  buildContext: () => Omit<RecipeAssistInput, "question">;
  onApplySuggestion: (
    s: RecipeAssistSuggestion,
  ) => { ok: boolean; message: string; undo?: () => void };
}) {
  const colors = useColors();
  const [turns, setTurns] = React.useState<
    { role: "user" | "assistant"; text: string; suggestion?: RecipeAssistSuggestion }[]
  >([]);
  const [question, setQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
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

  return (
    <Card title="Recipe & ingredient helper" icon="book-open" accent>
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>
        Ask about this run&apos;s recipes — e.g. &ldquo;scale the dough recipe to 1.5x&rdquo;,
        &ldquo;what can I substitute for X?&rdquo;, or &ldquo;explain how the dough batch is
        figured&rdquo;. Answers use only your real recipe data. Advisory only — nothing is changed.
      </Text>
      <ScrollView
        ref={scrollRef}
        style={[styles.thread, { borderColor: colors.border, backgroundColor: colors.background }]}
        contentContainerStyle={{ gap: 8, padding: 10 }}
        nestedScrollEnabled
      >
        {turns.length === 0 && !loading ? (
          <Text style={[styles.threadEmpty, { color: colors.mutedForeground }]}>
            No questions yet. Ask anything about your recipes or ingredients.
          </Text>
        ) : (
          turns.map((t, i) => (
            <View key={i} style={{ alignSelf: "stretch", gap: 6 }}>
              <View
                style={[
                  styles.bubble,
                  t.role === "user"
                    ? { alignSelf: "flex-end", backgroundColor: "rgba(14,165,233,0.18)" }
                    : { alignSelf: "flex-start", backgroundColor: colors.muted },
                ]}
              >
                <Text style={[styles.bubbleText, { color: colors.foreground }]}>{t.text}</Text>
              </View>
              {t.role === "assistant" && t.suggestion ? (
                <SuggestionCard suggestion={t.suggestion} onApply={onApplySuggestion} />
              ) : null}
            </View>
          ))
        )}
        {loading ? (
          <View style={[styles.bubble, { alignSelf: "flex-start", backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", gap: 8 }]}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Text style={[styles.bubbleText, { color: colors.mutedForeground }]}>Thinking…</Text>
          </View>
        ) : null}
      </ScrollView>

      {note ? (
        <View style={[styles.errorBox, { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.1)" }]}>
          <Feather name="alert-triangle" size={14} color="#fbbf24" />
          <Text style={[styles.errorText, { color: "#fbbf24" }]}>{note}</Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.errorBox, { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)" }]}>
          <Feather name="alert-triangle" size={14} color="#f87171" />
          <Text style={[styles.errorText, { color: "#f87171" }]}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
          ]}
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask about a recipe or ingredient…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          editable={!loading}
        />
        <Button
          label="Send"
          icon="send"
          onPress={send}
          disabled={loading || !question.trim()}
        />
      </View>
    </Card>
  );
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A window of `count` future days as local YYYY-MM-DD strings, beginning
// `startOffset` days after tomorrow. The window can be paged forward without
// limit (Earlier/Later) so the manager can forecast ANY future day, while still
// never targeting today or the past. Mirrors the web date input's min=tomorrow
// constraint with no upper bound (replit.md parity).
function futureDates(startOffset: number, count: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1 + startOffset + i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function fmtForecastChip(iso: string): { weekday: string; day: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return {
    weekday: dt.toLocaleDateString(undefined, { weekday: "short" }),
    day: dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

function confidenceColors(c: ForecastConfidence): { bg: string; fg: string } {
  if (c === "high") return { bg: "rgba(16,185,129,0.15)", fg: "#34d399" };
  if (c === "low") return { bg: "rgba(239,68,68,0.15)", fg: "#f87171" };
  return { bg: "rgba(245,158,11,0.15)", fg: "#fbbf24" };
}

function formatTargetDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// Manager-only demand forecast. Predicts an upcoming day's run plan grounded in
// real history; advisory only. The manager picks the target day (defaults to
// tomorrow) then tapping "Add to schedule" adds the runs to the schedule for the
// target date and navigates there for review — nothing is auto-committed. EXACT
// mirror of the web ForecastSection (replit.md parity).
function ForecastSection({
  buildForecast,
  onApplyForecast,
}: {
  buildForecast: (targetDate: string) => ReturnType<typeof buildForecastInput>;
  onApplyForecast: (plan: ForecastPlan) => void;
}) {
  const colors = useColors();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    forecast: ForecastPlan | null;
    note?: string;
    generatedAt: number;
  } | null>(null);
  const [applied, setApplied] = React.useState(false);
  const [windowStart, setWindowStart] = React.useState(0);
  const dates = React.useMemo(() => futureDates(windowStart, 14), [windowStart]);
  const [targetDate, setTargetDate] = React.useState(tomorrowStr());

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
  const tomorrow = tomorrowStr();

  return (
    <>
      <Card title="Demand Forecast" icon="calendar" accent>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Predict an upcoming day&apos;s run plan from recent production history — what to run, rough
          quantities, and a sensible order. Advisory only; you review and adjust it in the schedule
          before anything is planned.
        </Text>
        <View style={styles.forecastDateHeader}>
          <Text style={[styles.forecastDateLabel, { color: colors.mutedForeground }]}>
            FORECAST DAY
          </Text>
          <View style={styles.forecastNavRow}>
            <Pressable
              onPress={() => setWindowStart((s) => Math.max(0, s - 14))}
              disabled={windowStart === 0}
              hitSlop={8}
              style={[
                styles.forecastNavBtn,
                {
                  borderColor: colors.border,
                  opacity: windowStart === 0 ? 0.4 : 1,
                },
              ]}
            >
              <Feather name="chevron-left" size={14} color={colors.foreground} />
              <Text style={[styles.forecastNavText, { color: colors.foreground }]}>Earlier</Text>
            </Pressable>
            <Pressable
              onPress={() => setWindowStart((s) => s + 14)}
              hitSlop={8}
              style={[styles.forecastNavBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.forecastNavText, { color: colors.foreground }]}>Later</Text>
              <Feather name="chevron-right" size={14} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.forecastDateRow}
        >
          {dates.map((d) => {
            const sel = d === targetDate;
            const { weekday, day } = fmtForecastChip(d);
            return (
              <Pressable
                key={d}
                onPress={() => setTargetDate(d)}
                style={[
                  styles.forecastDateChip,
                  {
                    backgroundColor: sel ? colors.primary : colors.background,
                    borderColor: sel ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.forecastDateWeekday,
                    { color: sel ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {d === tomorrow ? "Tomorrow" : weekday}
                </Text>
                <Text
                  style={[
                    styles.forecastDateDay,
                    { color: sel ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Button
          label={
            loading
              ? "Forecasting…"
              : result
                ? "Re-forecast"
                : `Forecast ${formatTargetDate(targetDate || tomorrow)}`
          }
          icon={result && !loading ? "refresh-cw" : "calendar"}
          onPress={predict}
          disabled={loading}
          style={{ marginTop: 12 }}
        />
        {error ? (
          <View style={[styles.errorBox, { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)" }]}>
            <Feather name="alert-triangle" size={14} color="#f87171" />
            <Text style={[styles.errorText, { color: "#f87171" }]}>{error}</Text>
          </View>
        ) : null}
      </Card>

      {result && !plan ? (
        <Card>
          <View style={styles.emptyBox}>
            <Feather name="calendar" size={22} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No forecast yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {result.note ??
                "There isn't enough production history to forecast responsibly yet. Finish a few days of runs and try again."}
            </Text>
          </View>
        </Card>
      ) : null}

      {plan ? (
        <Card title={`Plan for ${formatTargetDate(plan.targetDate)}`} icon="calendar">
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
            <View style={[styles.badge, { backgroundColor: confidenceColors(plan.confidence).bg }]}>
              <Text style={[styles.badgeText, { color: confidenceColors(plan.confidence).fg }]}>
                {plan.confidence.toUpperCase()} CONFIDENCE
              </Text>
            </View>
          </View>
          {plan.summary ? (
            <Text style={[styles.recDetail, { color: colors.mutedForeground, marginTop: 0 }]}>
              {plan.summary}
            </Text>
          ) : null}
          <View style={{ gap: 8, marginTop: 10 }}>
            {plan.runs.map((r, i) => (
              <View
                key={i}
                style={[styles.recCard, { backgroundColor: colors.background, borderColor: colors.border }]}
              >
                <View style={styles.recHeader}>
                  <Text style={[styles.recTitle, { color: colors.foreground }]}>
                    {r.brand}
                    {r.flavor ? ` · ${r.flavor}` : ""}
                  </Text>
                  <Text style={[styles.recApplies, { color: colors.primary, marginTop: 0 }]}>
                    {r.casesNeeded > 0 ? `${r.casesNeeded} cs` : "—"}
                  </Text>
                </View>
                {r.dieType ? (
                  <Text style={[styles.recApplies, { color: colors.mutedForeground }]}>
                    Die: {r.dieType}
                  </Text>
                ) : null}
                {r.rationale ? (
                  <Text style={[styles.recDetail, { color: colors.mutedForeground }]}>{r.rationale}</Text>
                ) : null}
              </View>
            ))}
          </View>
          {result?.note ? (
            <View style={[styles.errorBox, { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.1)" }]}>
              <Feather name="alert-triangle" size={14} color="#fbbf24" />
              <Text style={[styles.errorText, { color: "#fbbf24" }]}>{result.note}</Text>
            </View>
          ) : null}
          <Button
            label={applied ? "Opened in schedule" : "Add to schedule"}
            icon={applied ? "check" : "calendar"}
            variant={applied ? "outline" : "primary"}
            disabled={applied}
            onPress={() => {
              onApplyForecast(plan);
              setApplied(true);
            }}
            style={{ marginTop: 12 }}
          />
        </Card>
      ) : null}
    </>
  );
}

function accuracyStatusColors(s: ForecastAccuracyProductStatus): { bg: string; fg: string } {
  if (s === "hit") return { bg: "rgba(16,185,129,0.15)", fg: "#34d399" };
  if (s === "missed" || s === "unexpected") return { bg: "rgba(239,68,68,0.15)", fg: "#f87171" };
  return { bg: "rgba(245,158,11,0.15)", fg: "#fbbf24" };
}

const ACCURACY_STATUS_LABEL: Record<ForecastAccuracyProductStatus, string> = {
  hit: "ON TARGET",
  over: "OVER-PREDICTED",
  under: "UNDER-PREDICTED",
  missed: "NOT RUN",
  unexpected: "UNPLANNED",
};

function accuracyPctColors(pct: number): { bg: string; fg: string } {
  if (pct >= 85) return { bg: "rgba(16,185,129,0.15)", fg: "#34d399" };
  if (pct >= 60) return { bg: "rgba(245,158,11,0.15)", fg: "#fbbf24" };
  return { bg: "rgba(239,68,68,0.15)", fg: "#f87171" };
}

// Manager-only forecast accuracy. After a forecasted day finishes, compares what
// the forecast predicted against the actual finished runs. Read-only — no AI call,
// nothing committed. EXACT mirror of the web AccuracySection (replit.md parity).
function AccuracySection({ buildAccuracy }: { buildAccuracy: () => ForecastAccuracyInput }) {
  const colors = useColors();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    reviews: ForecastAccuracyReview[];
    note?: string;
    generatedAt: number;
  } | null>(null);

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
      <Card title="Forecast Accuracy" icon="bar-chart-2" accent>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          See how past demand forecasts held up against what actually ran. Compares each forecasted
          day&apos;s predicted brands, flavors, and cases to the finished runs so you can calibrate
          how much to trust upcoming forecasts.
        </Text>
        <Button
          label={loading ? "Checking…" : result ? "Re-check accuracy" : "Check past accuracy"}
          icon={result && !loading ? "refresh-cw" : "bar-chart-2"}
          onPress={review}
          disabled={loading}
          style={{ marginTop: 12 }}
        />
        {error ? (
          <View style={[styles.errorBox, { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)" }]}>
            <Feather name="alert-triangle" size={14} color="#f87171" />
            <Text style={[styles.errorText, { color: "#f87171" }]}>{error}</Text>
          </View>
        ) : null}
      </Card>

      {result && reviews.length === 0 ? (
        <Card>
          <View style={styles.emptyBox}>
            <Feather name="bar-chart-2" size={22} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No forecasts to score yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {result.note ??
                "Once a day you forecasted has finished its runs, its accuracy will show up here."}
            </Text>
          </View>
        </Card>
      ) : null}

      {reviews.map((rev) => (
        <Card key={rev.date} title={formatTargetDate(rev.date)} icon="bar-chart-2">
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
            <View style={[styles.badge, { backgroundColor: accuracyPctColors(rev.caseAccuracyPct).bg }]}>
              <Text style={[styles.badgeText, { color: accuracyPctColors(rev.caseAccuracyPct).fg }]}>
                {rev.caseAccuracyPct}% ACCURATE
              </Text>
            </View>
          </View>
          <Text style={[styles.recDetail, { color: colors.mutedForeground, marginTop: 0 }]}>
            Predicted {rev.predictedTotalCases} cs · Actual {rev.actualTotalCases} cs ·{" "}
            {rev.confidence} confidence at forecast time
          </Text>
          <View style={{ gap: 8, marginTop: 10 }}>
            {rev.products.map((p, i) => (
              <View
                key={i}
                style={[styles.recCard, { backgroundColor: colors.background, borderColor: colors.border }]}
              >
                <View style={styles.recHeader}>
                  <Text style={[styles.recTitle, { color: colors.foreground }]}>{p.label}</Text>
                  <View style={[styles.badge, { backgroundColor: accuracyStatusColors(p.status).bg }]}>
                    <Text style={[styles.badgeText, { color: accuracyStatusColors(p.status).fg }]}>
                      {ACCURACY_STATUS_LABEL[p.status]}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.recApplies, { color: colors.mutedForeground }]}>
                  Predicted {p.predictedCases} cs · Actual {p.actualCases} cs
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ))}
    </>
  );
}

export default function AssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isManager, isLoading: roleLoading } = useMe();
  const {
    run,
    allRuns,
    history,
    runToTime,
    scheduled,
    setRunToTime,
    moveRun,
    updateRunSettingsById,
    addScheduledRun,
    cheeseIngredients,
    doughIngredients,
    frontlineIngredients,
    addRun: ctxAddRun,
    switchRun: ctxSwitchRun,
    deleteRun: ctxDeleteRun,
    updateSettings: ctxUpdateSettings,
    updateProgress: ctxUpdateProgress,
    updateRunMeta: ctxUpdateRunMeta,
    endRun: ctxEndRun,
    addStoppage: ctxAddStoppage,
    endActiveStoppage: ctxEndActiveStoppage,
    rolloverDay: ctxRolloverDay,
  } = useRun();

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<OptimizeResult | null>(null);

  // Apply a one-tap AI recommendation action via the existing context
  // mutations. Mirrors the web applyOptimizeAction; nothing is applied without
  // the manager's explicit tap.
  function applyAction(action: OptimizeAction): { ok: boolean; message: string; undo?: () => void } {
    if (action.kind === "set_target_time") {
      const time = (action.time ?? "").trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, message: "Invalid time" };
      const prevTime = runToTime;
      setRunToTime(time);
      return {
        ok: true,
        message: `Finish time set to ${time}`,
        undo: () => setRunToTime(prevTime),
      };
    }

    if (action.kind === "set_run_target") {
      const runId = action.runId ?? "";
      const cases = Math.round(action.casesNeeded ?? NaN);
      if (!Number.isFinite(cases) || cases <= 0) return { ok: false, message: "Invalid target" };
      const target = allRuns.find((r) => r.id === runId);
      if (!target) return { ok: false, message: "Run no longer exists" };
      const prevCases = target.settings.casesNeeded;
      updateRunSettingsById(runId, { casesNeeded: cases });
      return {
        ok: true,
        message: `Target set to ${cases} cases`,
        undo: () => updateRunSettingsById(runId, { casesNeeded: prevCases }),
      };
    }

    // reorder_run
    const runId = action.runId ?? "";
    const fromIdx = allRuns.findIndex((r) => r.id === runId);
    if (fromIdx < 0) return { ok: false, message: "Run no longer exists" };
    const beforeId = action.beforeRunId ?? null;
    let toIdx: number;
    if (beforeId === null) {
      toIdx = allRuns.length - 1;
    } else {
      const remaining = allRuns.filter((r) => r.id !== runId);
      const beforePos = remaining.findIndex((r) => r.id === beforeId);
      if (beforePos < 0) return { ok: false, message: "Target run no longer exists" };
      toIdx = beforePos;
    }
    if (toIdx === fromIdx) return { ok: true, message: "Already in place" };
    moveRun(fromIdx, toIdx);
    return {
      ok: true,
      message: "Run order updated",
      undo: () => moveRun(toIdx, fromIdx),
    };
  }

  // Apply a confirm-first recipe suggestion from the AI helper (a scaled recipe
  // or a substitution) to the CURRENT run's matching recipe rows. Routes through
  // the existing updateRunSettingsById path — no new write surface. The worker
  // already tapped Apply; we return an undo that restores the previous rows.
  // EXACT mirror of the web applyRecipeSuggestion (replit.md parity).
  function applyRecipeSuggestion(
    s: RecipeAssistSuggestion,
  ): { ok: boolean; message: string; undo?: () => void } {
    if (!(RECIPE_FIELD_IDS as readonly string[]).includes(s.recipeId)) {
      return { ok: false, message: "Unknown recipe" };
    }
    const runId = run?.id;
    if (!runId) return { ok: false, message: "No active run" };

    const rows = (s.rows ?? [])
      .map((r) => ({ ingredient: (r.ingredient ?? "").trim(), lbs: Number(r.lbs) || 0 }))
      .filter((r) => r.ingredient);
    if (rows.length === 0) return { ok: false, message: "Nothing to apply" };

    const prevRaw = (run?.settings as unknown as Record<string, unknown>)?.[s.recipeId];
    const prev = (Array.isArray(prevRaw) ? prevRaw : ([] as { ingredient: string; lbs: number }[])).map(
      (r) => ({ ingredient: r.ingredient, lbs: r.lbs }),
    );

    const write = (next: { ingredient: string; lbs: number }[]) => {
      updateRunSettingsById(runId, { [s.recipeId]: next } as Partial<RunSettings>);
    };
    write(rows);
    return {
      ok: true,
      message: s.kind === "scale" ? "Recipe scaled" : "Substitution applied",
      undo: () => write(prev),
    };
  }

  // Build the platform handlers for dispatched voice commands. Each forwards to
  // an EXISTING RunContext / inventory mutation (no new write surface) and, where
  // the mobile context offers a clean inverse, returns an undo so a misheard
  // command can be reverted within the AskChat's short Undo window. Server-
  // resolved ids are validated again here (the run may have changed since
  // classification). EXACT parity with the web buildVoiceHandlers in
  // artifacts/run-calculator/src/pages/home.tsx — same kinds, same arguments
  // through dispatchVoiceCommand. The few structural ops mobile's context can't
  // cleanly reverse (finish run, remove run, start/end stoppage) execute
  // identically but omit the Undo button.
  function buildVoiceHandlers(): VoiceCommandHandlers {
    // --- Live, synchronously-updated shadow of run ordering + current index ---
    // dispatchVoiceCommand runs a command's actions in sequence within a single
    // task, BEFORE React re-renders, so the captured `allRuns`/`run` (and
    // appStateRef, which is refreshed on render) never reflect a switch / add /
    // remove / reorder made by an EARLIER action in the same utterance. The
    // RunContext mutations all compose correctly (each is a functional
    // setAppState updater), but a handler's OWN decisions — which run is current,
    // a runId's index, whether a switch is needed — must be made against an
    // equally-live view, or a later action lands on the wrong run. We therefore
    // shadow ordering + current index here and update it in lockstep with every
    // mutating handler, mirroring each context updater exactly. Run *content*
    // (started/ended/stoppages) is read from the command-start snapshot, which is
    // correct for the first action to touch a run; degenerate same-run content
    // sequences within a single utterance are not supported by design.
    type Shadow = { id: string; snap: (typeof allRuns)[number] | null };
    const liveRuns: Shadow[] = allRuns.map((r) => ({ id: r.id, snap: r }));
    let liveIdx = run ? liveRuns.findIndex((s) => s.id === run.id) : -1;
    let newRunSeq = 0;
    const findIdx = (runId: string) => liveRuns.findIndex((s) => s.id === runId);
    const snapAt = (idx: number): (typeof allRuns)[number] | null =>
      idx >= 0 && idx < liveRuns.length ? liveRuns[idx].snap : null;

    return {
      setTargetTime(time) {
        return applyAction({ kind: "set_target_time", label: "", time });
      },
      clearTargetTime() {
        const prev = runToTime;
        setRunToTime("");
        return { ok: true, message: "Finish time cleared", undo: () => setRunToTime(prev) };
      },
      setRunTarget(runId, casesNeeded) {
        return applyAction({ kind: "set_run_target", label: "", runId, casesNeeded });
      },
      reorderRun(runId, beforeRunId) {
        // Resolved against the live shadow (not the command-start `allRuns`) so a
        // reorder following an earlier add/remove/move still targets the right run.
        const fromIdx = findIdx(runId);
        if (fromIdx < 0) return { ok: false, message: "Run no longer exists" };
        let toIdx: number;
        if (beforeRunId == null) {
          toIdx = liveRuns.length - 1;
        } else {
          const remaining = liveRuns.filter((s) => s.id !== runId);
          const beforePos = remaining.findIndex((s) => s.id === beforeRunId);
          if (beforePos < 0) return { ok: false, message: "Target run no longer exists" };
          toIdx = beforePos;
        }
        if (toIdx === fromIdx) return { ok: true, message: "Already in place" };
        moveRun(fromIdx, toIdx);
        // Mirror RunContext.moveRun, including its "keep the same focused run"
        // currentIndex recomputation by run identity.
        const focusedId = liveIdx >= 0 ? liveRuns[liveIdx].id : null;
        const [moved] = liveRuns.splice(fromIdx, 1);
        liveRuns.splice(toIdx, 0, moved);
        if (focusedId != null) liveIdx = liveRuns.findIndex((s) => s.id === focusedId);
        return { ok: true, message: "Run order updated", undo: () => moveRun(toIdx, fromIdx) };
      },
      addRun(brand, flavor) {
        const prevLen = liveRuns.length;
        const prevIndex = liveIdx;
        // addRun appends and makes the new run current; updateSettings (queued
        // right after) then lands on that new current run.
        ctxAddRun();
        ctxUpdateSettings({ brand, flavor });
        // Mirror: a new run is appended and becomes current. Its real id is
        // unknown here, but a later action can't target it (it didn't exist when
        // the command was grounded), so a sentinel id is sufficient.
        liveRuns.push({ id: `__new_${newRunSeq++}__`, snap: null });
        liveIdx = liveRuns.length - 1;
        const name = `${brand} ${flavor}`.trim() || "run";
        return {
          ok: true,
          message: `Added ${name}`,
          undo: () => {
            ctxDeleteRun(prevLen);
            if (prevIndex >= 0) ctxSwitchRun(prevIndex);
          },
        };
      },
      removeRun(runId) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const target = snapAt(idx);
        if (target && (target.startedAt || target.endedAt)) {
          return { ok: false, message: "Can't remove a started or finished run" };
        }
        if (liveRuns.length <= 1) return { ok: false, message: "Can't remove the only run" };
        const prevSettings = target?.settings;
        ctxDeleteRun(idx);
        // Mirror RunContext.deleteRun: drop the run, clamp currentIndex.
        liveRuns.splice(idx, 1);
        liveIdx = Math.min(liveIdx, liveRuns.length - 1);
        // Re-add restores the run's data (un-started, so only settings matter);
        // it reappears at the end rather than its original slot.
        return {
          ok: true,
          message: "Run removed",
          undo: () => {
            ctxAddRun();
            if (prevSettings) ctxUpdateSettings(prevSettings);
          },
        };
      },
      switchRun(runId) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        if (idx === liveIdx) return { ok: true, message: "Already on that run" };
        const prevIndex = liveIdx;
        ctxSwitchRun(idx);
        liveIdx = idx;
        return {
          ok: true,
          message: "Switched run",
          undo: prevIndex >= 0 ? () => ctxSwitchRun(prevIndex) : undefined,
        };
      },
      updateRunMeta(runId, brand, flavor) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const target = snapAt(idx);
        const newBrand = brand ?? target?.settings.brand ?? "";
        const newFlavor = flavor ?? target?.settings.flavor ?? "";
        const prevBrand = target?.settings.brand ?? "";
        const prevFlavor = target?.settings.flavor ?? "";
        const name = `${newBrand} ${newFlavor}`.trim() || "run";
        updateRunSettingsById(runId, { brand: newBrand, flavor: newFlavor });
        return {
          ok: true,
          message: `Renamed to ${name}`,
          undo: () => updateRunSettingsById(runId, { brand: prevBrand, flavor: prevFlavor }),
        };
      },
      finishRun(runId) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const target = snapAt(idx);
        if (target?.endedAt) return { ok: false, message: "Run already finished" };
        if (target && !target.startedAt) return { ok: false, message: "Run hasn't started yet" };
        if (idx !== liveIdx) {
          ctxSwitchRun(idx);
          liveIdx = idx;
        }
        ctxEndRun();
        // No un-finish primitive on mobile (endRun also consumes inventory
        // idempotently), so no Undo — the command itself runs at web parity.
        return { ok: true, message: "Run finished" };
      },
      startStoppage(runId, reason, stoppageType) {
        const targetIdx = runId ? findIdx(runId) : liveIdx;
        if (targetIdx < 0) return { ok: false, message: "Run no longer exists" };
        if (targetIdx !== liveIdx) {
          ctxSwitchRun(targetIdx);
          liveIdx = targetIdx;
        }
        ctxAddStoppage(stoppageType, reason);
        // Mobile has no remove-stoppage primitive, so no Undo button.
        return {
          ok: true,
          message: reason ? `Stoppage started: ${reason}` : "Stoppage started",
        };
      },
      endStoppage(runId) {
        const targetIdx = runId ? findIdx(runId) : liveIdx;
        if (targetIdx < 0) return { ok: false, message: "Run no longer exists" };
        if (targetIdx !== liveIdx) {
          ctxSwitchRun(targetIdx);
          liveIdx = targetIdx;
        }
        const target = snapAt(targetIdx);
        if (target && !target.stoppages.some((s) => s.endedAt == null)) {
          return { ok: false, message: "No active stoppage" };
        }
        ctxEndActiveStoppage();
        // No reopen-stoppage primitive on mobile, so no Undo button.
        return { ok: true, message: "Stoppage ended" };
      },
      setRunProgress(runId, progress) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const target = snapAt(idx);
        const prev = {
          skidsCompleted: target?.progress.skidsCompleted,
          casesOnCurrentSkid: target?.progress.casesOnCurrentSkid,
          casesPerSkid: target?.settings.casesPerSkid,
        };
        // casesPerSkid is a per-run SETTING; skids/cases-on-skid are PROGRESS.
        // updateProgress acts on the current run, so switch first for another run.
        const writeProgress = (p: {
          skidsCompleted?: number;
          casesOnCurrentSkid?: number;
          casesPerSkid?: number;
        }) => {
          if (p.casesPerSkid != null) updateRunSettingsById(runId, { casesPerSkid: p.casesPerSkid });
          if (p.skidsCompleted != null || p.casesOnCurrentSkid != null) {
            if (idx !== liveIdx) {
              ctxSwitchRun(idx);
              liveIdx = idx;
            }
            ctxUpdateProgress({
              ...(p.skidsCompleted != null ? { skidsCompleted: p.skidsCompleted } : {}),
              ...(p.casesOnCurrentSkid != null ? { casesOnCurrentSkid: p.casesOnCurrentSkid } : {}),
            });
          }
        };
        writeProgress(progress);
        return { ok: true, message: "Progress updated", undo: () => writeProgress(prev) };
      },
      logActualCases(runId, actualCases) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const prev = snapAt(idx)?.actualCases;
        ctxUpdateRunMeta(runId, { actualCases });
        return {
          ok: true,
          message: `Logged ${actualCases} cases`,
          undo: () => ctxUpdateRunMeta(runId, { actualCases: prev }),
        };
      },
      logWaste(runId, wasteLbs) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const prev = snapAt(idx)?.wasteLbs;
        ctxUpdateRunMeta(runId, { wasteLbs });
        return {
          ok: true,
          message: `Logged ${wasteLbs} lbs waste`,
          undo: () => ctxUpdateRunMeta(runId, { wasteLbs: prev }),
        };
      },
      async restockItem(body) {
        await restockInventory({
          itemKey: body.itemKey,
          category: body.category,
          name: body.name,
          unit: body.unit,
          qty: body.qty,
        });
        return { ok: true, message: `Restocked ${body.qty} ${body.unit} of ${body.name}` };
      },
      async adjustItem(body) {
        await adjustInventory({ itemId: body.itemId, qtyDelta: body.qtyDelta, note: body.note });
        const sign = body.qtyDelta >= 0 ? "+" : "";
        return {
          ok: true,
          message: `Adjusted stock ${sign}${body.qtyDelta}`,
          undo: async () => {
            await adjustInventory({
              itemId: body.itemId,
              qtyDelta: -body.qtyDelta,
              note: "Undo voice adjustment",
            });
          },
        };
      },
      rollover() {
        // Reuse the context's manual day close-out. Irreversible by design — no
        // undo (gated to managers in the shared VOICE_COMMAND_ROLES map).
        ctxRolloverDay();
        return { ok: true, message: "Day rolled over" };
      },
    };
  }

  // Entry point passed to AskChat: dispatch the server-resolved actions through
  // the shared, parity-critical mapping with this user's role.
  const applyVoiceCommand = (actions: VoiceCommandAction[]): Promise<VoiceCommandResult[]> =>
    dispatchVoiceCommand(actions, buildVoiceHandlers(), isManager);

  // Shared day-state builder used by both the chat box and the optimize button,
  // so both send the model identically-shaped data.
  const buildInput = React.useCallback((): OptimizeInput => {
    const scheduledDays = Object.entries(scheduled).map(([date, runs]) => ({
      date,
      runs: runs.map((r) => ({
        brand: r.brand,
        flavor: r.flavor,
        casesNeeded: r.casesNeeded,
        dieType: r.dieType,
      })),
    }));
    return buildOptimizeInput({
      date: todayStr(),
      nowMs: Date.now(),
      runToTime,
      runs: allRuns,
      history,
      scheduledDays,
    });
  }, [scheduled, runToTime, allRuns, history]);

  // Shape the current run's recipes + known ingredient pool + run context for the
  // recipe & ingredient helper. Mirrors the web buildRecipeContext wiring; the
  // extraction itself lives in the shared buildRecipeAssistContext (replit.md
  // parity).
  const buildRecipeContext = React.useCallback((): Omit<RecipeAssistInput, "question"> => {
    const s = run?.settings;
    return buildRecipeAssistContext(
      s ?? {},
      [...cheeseIngredients, ...doughIngredients, ...frontlineIngredients],
      {
        brand: s?.brand,
        flavor: s?.flavor,
        casesNeeded: s?.casesNeeded,
        pizzasPerCase: s?.pizzasPerCase,
        doughballWeightOz: s?.doughballWeightOz,
      },
    );
  }, [run, cheeseIngredients, doughIngredients, frontlineIngredients]);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await requestOptimize(buildInput());
      setResult(res);
    } catch (e) {
      setError(optimizeErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // Shapes recent finished history + scheduled days into the forecast wire input.
  // Mirrors the web buildForecast wiring (replit.md parity).
  const buildForecast = React.useCallback(
    (targetDate: string) => {
      const scheduledDays = Object.entries(scheduled).map(([date, runs]) => ({
        date,
        runs: runs.map((r) => ({
          brand: r.brand,
          flavor: r.flavor,
          casesNeeded: r.casesNeeded,
          dieType: r.dieType,
        })),
      }));
      return buildForecastInput({
        targetDate: targetDate || tomorrowStr(),
        nowMs: Date.now(),
        history,
        scheduledDays,
      });
    },
    [scheduled, history],
  );

  // Shapes recent finished history into the accuracy wire input — the server
  // reads the recorded forecasts itself. Mirrors the web buildAccuracy wiring.
  const buildAccuracy = React.useCallback(() => {
    return buildForecastAccuracyInput({ nowMs: Date.now(), history });
  }, [history]);

  // Non-destructive apply: add each forecast run to the schedule for the target
  // date, then navigate to the schedule screen so the manager reviews/adjusts.
  // Nothing is auto-committed beyond seeding the editable schedule.
  function applyForecast(plan: ForecastPlan) {
    const date = plan.targetDate || tomorrowStr();
    for (const r of plan.runs) {
      const cases = Number.isFinite(r.casesNeeded) && r.casesNeeded > 0 ? Math.round(r.casesNeeded) : 0;
      addScheduledRun(date, {
        brand: r.brand,
        flavor: r.flavor,
        casesNeeded: cases,
        dieType: r.dieType ?? "",
        notes: r.rationale ?? "",
      });
    }
    router.push("/schedule");
  }

  const recsFor = (cat: OptimizeCategory) =>
    (result?.recommendations ?? []).filter((r) => r.category === cat);
  const hasRecs = (result?.recommendations.length ?? 0) > 0;

  if (roleLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 14 }}
    >
      <AskChat buildInput={buildInput} onApplyVoiceCommand={applyVoiceCommand} />

      <RecipeAssistChat
        buildContext={buildRecipeContext}
        onApplySuggestion={applyRecipeSuggestion}
      />

      {!isManager ? null : (
      <>
      <ForecastSection buildForecast={buildForecast} onApplyForecast={applyForecast} />

      <AccuracySection buildAccuracy={buildAccuracy} />

      <Card title="AI Assistant" icon="zap" accent>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Analyze today&apos;s runs, the schedule, and recent history for run sequencing, break
          timing, and efficiency recommendations. Advisory only — nothing is applied automatically.
        </Text>
        <Button
          label={loading ? "Analyzing…" : result ? "Re-analyze" : "Analyze shift"}
          icon={result && !loading ? "refresh-cw" : "zap"}
          onPress={analyze}
          disabled={loading}
          style={{ marginTop: 12 }}
        />
        {error ? (
          <View style={[styles.errorBox, { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)" }]}>
            <Feather name="alert-triangle" size={14} color="#f87171" />
            <Text style={[styles.errorText, { color: "#f87171" }]}>{error}</Text>
          </View>
        ) : null}
      </Card>

      {result && !hasRecs ? (
        <Card>
          <View style={styles.emptyBox}>
            <Feather name="zap" size={22} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No recommendations yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {result.note ??
                "There isn't enough run data to analyze yet. Start a run and try again once production is underway."}
            </Text>
          </View>
        </Card>
      ) : null}

      {result && hasRecs
        ? CATEGORY_ORDER.map((cat) => {
            const recs = recsFor(cat);
            if (recs.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <Card key={cat} title={meta.label} icon={meta.icon}>
                <Text style={[styles.catDesc, { color: colors.mutedForeground }]}>{meta.desc}</Text>
                <View style={{ gap: 8 }}>
                  {recs.map((r, i) => (
                    <RecCard key={i} rec={r} onApply={applyAction} />
                  ))}
                </View>
              </Card>
            );
          })
        : null}
      </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  intro: { fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular },
  forecastDateHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    marginBottom: 8,
  },
  forecastDateLabel: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
  },
  forecastNavRow: { flexDirection: "row", gap: 6 },
  forecastNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  forecastNavText: { fontSize: 11, fontFamily: FONTS.medium },
  forecastDateRow: { flexDirection: "row", gap: 8, paddingRight: 4 },
  forecastDateChip: {
    minWidth: 64,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  forecastDateWeekday: { fontSize: 11, fontFamily: FONTS.medium },
  forecastDateDay: { fontSize: 13, fontFamily: FONTS.bold, marginTop: 2 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: FONTS.regular },
  catDesc: { fontSize: 12, marginBottom: 10, fontFamily: FONTS.regular },
  recCard: { borderWidth: 1, borderRadius: 10, padding: 12 },
  recHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  recTitle: { flex: 1, fontSize: 14, fontFamily: FONTS.semibold },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  recDetail: { marginTop: 6, fontSize: 12, lineHeight: 18, fontFamily: FONTS.regular },
  recApplies: { marginTop: 6, fontSize: 11, fontFamily: FONTS.medium },
  actionRow: { marginTop: 10, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  actionMsg: { fontSize: 11, fontFamily: FONTS.medium },
  suggestionCard: { borderWidth: 1, borderRadius: 10, padding: 10, alignSelf: "stretch" },
  suggestionHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  suggestionKind: { fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  suggestionTitle: { marginTop: 4, fontSize: 12, fontFamily: FONTS.semibold },
  suggestionRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  suggestionRowName: { flex: 1, fontSize: 11, fontFamily: FONTS.regular },
  suggestionRowLbs: { fontSize: 11, fontFamily: FONTS.mono },
  emptyBox: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyTitle: { fontSize: 14, fontFamily: FONTS.semibold },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 280, fontFamily: FONTS.regular },
  thread: {
    marginTop: 12,
    maxHeight: 280,
    borderWidth: 1,
    borderRadius: 10,
  },
  threadEmpty: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingVertical: 20,
    fontFamily: FONTS.regular,
  },
  bubble: { maxWidth: "85%", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  bubbleText: { fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular },
  inputRow: { marginTop: 12, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  micBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  micDenied: { marginTop: 8, fontSize: 11, lineHeight: 16, fontFamily: FONTS.regular },
  voiceResult: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  voiceResultLabel: { fontSize: 12, fontFamily: FONTS.medium },
  voiceResultMsg: { fontSize: 11, lineHeight: 15, fontFamily: FONTS.regular, marginTop: 1 },
  voiceUndoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  voiceUndoText: { fontSize: 11, fontFamily: FONTS.medium },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },
});
