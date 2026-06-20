import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card } from "@/components/UI";
import ReviewBadge from "@/components/ReviewBadge";
import { FONTS } from "@/constants/fonts";
import { todayStr, useRun } from "@/context/RunContext";
import {
  buildOptimizeInput,
  optimizeErrorMessage,
  requestOptimize,
  type OptimizeAction,
  type OptimizeCategory,
  type OptimizeImpact,
  type OptimizeRecommendation,
  type OptimizeResult,
} from "@/context/aiOptimize";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";

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

export default function AssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isManager, isLoading: roleLoading } = useMe();
  const {
    allRuns,
    history,
    runToTime,
    scheduled,
    setRunToTime,
    moveRun,
    updateRunSettingsById,
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

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const scheduledDays = Object.entries(scheduled).map(([date, runs]) => ({
        date,
        runs: runs.map((r) => ({
          brand: r.brand,
          flavor: r.flavor,
          casesNeeded: r.casesNeeded,
          dieType: r.dieType,
        })),
      }));
      const input = buildOptimizeInput({
        date: todayStr(),
        nowMs: Date.now(),
        runToTime,
        runs: allRuns,
        history,
        scheduledDays,
      });
      const res = await requestOptimize(input);
      setResult(res);
    } catch (e) {
      setError(optimizeErrorMessage(e));
    } finally {
      setLoading(false);
    }
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

  if (!isManager) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: 16 }]}>
        <Card>
          <View style={styles.emptyBox}>
            <Feather name="lock" size={22} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Managers only</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              The AI assistant is available to managers. Ask a manager to review optimization
              recommendations.
            </Text>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 14 }}
    >
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  intro: { fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular },
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
  emptyBox: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyTitle: { fontSize: 14, fontFamily: FONTS.semibold },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 280, fontFamily: FONTS.regular },
});
