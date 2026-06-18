import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { todayStr, useRun } from "@/context/RunContext";
import {
  buildOptimizeInput,
  optimizeErrorMessage,
  requestOptimize,
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

function RecCard({ rec }: { rec: OptimizeRecommendation }) {
  const colors = useColors();
  const ic = impactColors(rec.impact);
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
    </View>
  );
}

export default function AssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isManager, isLoading: roleLoading } = useMe();
  const { allRuns, history, runToTime, scheduled } = useRun();

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<OptimizeResult | null>(null);

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
                    <RecCard key={i} rec={r} />
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
  emptyBox: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyTitle: { fontSize: 14, fontFamily: FONTS.semibold },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 280, fontFamily: FONTS.regular },
});
