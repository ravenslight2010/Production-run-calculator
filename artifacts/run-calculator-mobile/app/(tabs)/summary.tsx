import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SectionHeader } from "@/components/UI";
import {
  computeCalc,
  historicalBenchmarkPpm,
  runLabel,
  todayStr,
  useRun,
  type RunState,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { exportRunsCsv } from "@/utils/exportCsv";
import { shareShiftReport } from "@/utils/shiftReport";

type RunStatus = "finished" | "current" | "upcoming";

function statusOf(r: RunState): RunStatus {
  if (r.endedAt != null) return "finished";
  if (r.isRunning || r.startedAt != null) return "current";
  return "upcoming";
}

function fmtClock(ms?: number): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function fmtDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface RunStats {
  status: RunStatus;
  planned: number;
  casesMade: number;
  pizzasMade: number;
  ppm: number;
  downtimeSec: number;
  netRunSec: number;
  start: string | null;
  end: string | null;
}

function computeRunStats(r: RunState, now: number): RunStats {
  const calc = computeCalc(r, now);
  const planned = r.settings.casesNeeded;
  const casesMade = Math.max(0, planned - calc.casesLeft);
  return {
    status: statusOf(r),
    planned,
    casesMade,
    pizzasMade: casesMade * r.settings.pizzasPerCase,
    ppm: calc.ppm,
    downtimeSec: calc.totalDowntimeSec,
    netRunSec: calc.netElapsedSec,
    start: fmtClock(r.startedAt),
    end: fmtClock(r.endedAt),
  };
}

function RunCard({ run, index }: { run: RunState; index: number }) {
  const colors = useColors();
  const stats = computeRunStats(run, Date.now());
  const pct = stats.planned > 0 ? Math.min(1, stats.casesMade / stats.planned) : 0;

  const accent =
    stats.status === "current"
      ? colors.primary
      : stats.status === "finished"
        ? colors.success
        : colors.mutedForeground;

  return (
    <View
      style={[
        styles.runCard,
        {
          backgroundColor: colors.card,
          borderColor:
            stats.status === "upcoming" ? colors.border : accent + "55",
        },
      ]}
    >
      <View style={styles.runHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.labelRow}>
            <Text
              style={[styles.runLabel, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {runLabel(run, index)}
            </Text>
            {run.settings.dieType ? (
              <View style={[styles.dieBadge, { borderColor: colors.border }]}>
                <Text style={[styles.dieText, { color: colors.mutedForeground }]}>
                  {run.settings.dieType}
                </Text>
              </View>
            ) : null}
          </View>
          {stats.start ? (
            <Text style={[styles.runTime, { color: colors.mutedForeground }]}>
              {stats.start}
              {stats.end ? ` → ${stats.end}` : " → running"}
            </Text>
          ) : null}
        </View>
        <View
          style={[styles.statusPill, { backgroundColor: accent + "22" }]}
        >
          <Text style={[styles.statusText, { color: accent }]}>
            {stats.status}
          </Text>
        </View>
      </View>

      <View style={styles.statRow}>
        {[
          { label: "Cases", val: stats.casesMade > 0 ? stats.casesMade.toLocaleString() : "—" },
          { label: "Planned", val: stats.planned > 0 ? stats.planned.toLocaleString() : "—" },
          {
            label: "PPM",
            val: stats.ppm > 0 ? Math.round(stats.ppm).toString() : "—",
            color: stats.ppm > 0 ? colors.success : colors.mutedForeground,
          },
        ].map((s) => (
          <View
            key={s.label}
            style={[styles.statBox, { backgroundColor: colors.secondary }]}
          >
            <Text style={[styles.statBoxLabel, { color: colors.mutedForeground }]}>
              {s.label}
            </Text>
            <Text
              style={[
                styles.statBoxVal,
                { color: s.color ?? colors.foreground },
              ]}
            >
              {s.val}
            </Text>
          </View>
        ))}
      </View>

      {stats.status !== "upcoming" ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressLabels}>
            <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
              {stats.casesMade} / {stats.planned} cases
            </Text>
            <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
              {Math.round(pct * 100)}%
            </Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${pct * 100}%`, backgroundColor: accent },
              ]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function SummaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { allRuns, tick, shiftNotes, setShiftNotes, history } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const now = Date.now();
  void tick; // re-render on tick
  const allStats = allRuns.map((r) => computeRunStats(r, now));

  const totalCases = allStats.reduce((a, s) => a + s.casesMade, 0);
  const totalPizzas = allStats.reduce((a, s) => a + s.pizzasMade, 0);
  const totalNetSec = allStats.reduce((a, s) => a + s.netRunSec, 0);
  const totalDownSec = allStats.reduce((a, s) => a + s.downtimeSec, 0);
  const todayPPM =
    totalNetSec > 0 ? Math.round(totalPizzas / (totalNetSec / 60)) : 0;

  const benchmark = historicalBenchmarkPpm(history);
  const benchDiff = benchmark != null && todayPPM > 0 ? todayPPM - benchmark.ppm : null;

  const shiftStats = [
    { label: "Cases Made", val: totalCases.toLocaleString(), color: colors.foreground },
    { label: "Net Run Time", val: fmtDuration(totalNetSec), color: colors.foreground },
    {
      label: "Downtime",
      val: fmtDuration(totalDownSec),
      color: totalDownSec > 0 ? colors.warning : colors.foreground,
    },
    {
      label: "Today PPM",
      val: todayPPM > 0 ? todayPPM.toString() : "—",
      color: todayPPM > 0 ? colors.success : colors.mutedForeground,
    },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: 16,
        paddingTop: webTop + 8,
        paddingBottom: insets.bottom + webBottom + 100,
      }}
    >
      <View style={styles.shiftHeader}>
        <Text style={[styles.shiftTitle, { color: colors.foreground }]}>
          Today&apos;s Shift
        </Text>
        <View style={styles.shiftHeaderRight}>
          <Text style={[styles.shiftCount, { color: colors.mutedForeground }]}>
            {allRuns.length} {allRuns.length === 1 ? "run" : "runs"}
          </Text>
          {allRuns.length > 0 ? (
            <>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  shareShiftReport(todayStr(), allRuns, shiftNotes);
                }}
                style={({ pressed }) => [
                  styles.exportBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="file-text" size={13} color={colors.primary} />
                <Text style={[styles.exportBtnText, { color: colors.primary }]}>
                  Share Report
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  exportRunsCsv(todayStr(), allRuns);
                }}
                style={({ pressed }) => [
                  styles.exportBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="share" size={13} color={colors.primary} />
                <Text style={[styles.exportBtnText, { color: colors.primary }]}>
                  Export CSV
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>

      <View
        style={[
          styles.statsGrid,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {shiftStats.map((s, i) => (
          <View
            key={s.label}
            style={[
              styles.statsCell,
              {
                borderColor: colors.border,
                borderRightWidth: i % 2 === 0 ? StyleSheet.hairlineWidth : 0,
                borderBottomWidth: i < 2 ? StyleSheet.hairlineWidth : 0,
              },
            ]}
          >
            <Text style={[styles.statsCellLabel, { color: colors.mutedForeground }]}>
              {s.label.toUpperCase()}
            </Text>
            <Text style={[styles.statsCellVal, { color: s.color }]}>{s.val}</Text>
          </View>
        ))}
      </View>

      {benchmark != null ? (
        <View
          style={[
            styles.benchCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.benchLeft}>
            <Feather name="trending-up" size={15} color={colors.mutedForeground} />
            <Text style={[styles.benchText, { color: colors.mutedForeground }]}>
              Historical average: {benchmark.ppm} PPM across {benchmark.count} finished{" "}
              {benchmark.count === 1 ? "run" : "runs"}
            </Text>
          </View>
          {benchDiff != null ? (
            <View
              style={[
                styles.benchPill,
                {
                  backgroundColor:
                    benchDiff >= 0 ? colors.success : colors.destructive,
                },
              ]}
            >
              <Feather
                name={benchDiff >= 0 ? "arrow-up" : "arrow-down"}
                size={12}
                color="#fff"
              />
              <Text style={styles.benchPillText}>
                {Math.abs(benchDiff)} PPM
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <SectionHeader title="Runs" />
      <View style={{ gap: 12 }}>
        {allRuns.map((r, i) => (
          <RunCard key={r.id} run={r} index={i} />
        ))}
      </View>

      <SectionHeader title="Shift Notes" />
      <View
        style={[
          styles.notesCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <TextInput
          style={[styles.notesInput, { color: colors.foreground }]}
          value={shiftNotes}
          onChangeText={setShiftNotes}
          placeholder="Handoff notes, issues, observations…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>

      {history.length > 0 ? (
        <>
          <SectionHeader title="History" />
          <View style={{ gap: 10 }}>
            {history.map((day) => {
              const dStats = day.runs.map((r) => computeRunStats(r, now));
              const cases = dStats.reduce((a, s) => a + s.casesMade, 0);
              const pizzas = dStats.reduce((a, s) => a + s.pizzasMade, 0);
              const net = dStats.reduce((a, s) => a + s.netRunSec, 0);
              const ppm = net > 0 ? Math.round(pizzas / (net / 60)) : 0;
              return (
                <View
                  key={day.date}
                  style={[
                    styles.histCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.histDate, { color: colors.foreground }]}>
                      {fmtDate(day.date)}
                    </Text>
                    <Text style={[styles.histMeta, { color: colors.mutedForeground }]}>
                      {day.runs.length} {day.runs.length === 1 ? "run" : "runs"} ·{" "}
                      {fmtDuration(net)} run time
                    </Text>
                  </View>
                  <View style={styles.histStat}>
                    <Text style={[styles.histVal, { color: colors.foreground }]}>
                      {cases.toLocaleString()}
                    </Text>
                    <Text style={[styles.histValLabel, { color: colors.mutedForeground }]}>
                      cases
                    </Text>
                  </View>
                  <View style={styles.histStat}>
                    <Text
                      style={[
                        styles.histVal,
                        { color: ppm > 0 ? colors.success : colors.mutedForeground },
                      ]}
                    >
                      {ppm > 0 ? ppm : "—"}
                    </Text>
                    <Text style={[styles.histValLabel, { color: colors.mutedForeground }]}>
                      ppm
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      exportRunsCsv(day.date, day.runs);
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.histExportBtn,
                      { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Feather name="share" size={15} color={colors.primary} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  shiftHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  shiftTitle: { fontSize: 15, fontWeight: "600" as const },
  shiftCount: { fontSize: 13 },
  shiftHeaderRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  exportBtnText: { fontSize: 12, fontWeight: "600" as const },
  histExportBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    marginLeft: 8,
  },

  statsGrid: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    overflow: "hidden",
  },
  statsCell: { width: "50%", paddingHorizontal: 16, paddingVertical: 14 },
  statsCellLabel: {
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  statsCellVal: { fontSize: 26, fontWeight: "800" as const },

  benchCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
  },
  benchLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  benchText: { fontSize: 13, flex: 1 },
  benchPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  benchPillText: { color: "#fff", fontSize: 12, fontWeight: "700" as const },

  runCard: { borderRadius: 16, borderWidth: 1, padding: 14 },
  runHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  runLabel: { fontSize: 15, fontWeight: "700" as const, flexShrink: 1 },
  runTime: { fontSize: 11, marginTop: 2 },
  dieBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  dieText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700" as const,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  statRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  statBox: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  statBoxLabel: {
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  statBoxVal: { fontSize: 18, fontWeight: "800" as const },

  progressWrap: { gap: 5 },
  progressLabels: { flexDirection: "row", justifyContent: "space-between" },
  progressText: { fontSize: 11, fontWeight: "600" as const },
  progressTrack: { height: 6, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999 },

  notesCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  notesInput: {
    fontSize: 15,
    minHeight: 90,
    padding: Platform.OS === "web" ? 4 : 0,
  },

  histCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  histDate: { fontSize: 15, fontWeight: "700" as const },
  histMeta: { fontSize: 12, marginTop: 2 },
  histStat: { alignItems: "center", minWidth: 48 },
  histVal: { fontSize: 18, fontWeight: "800" as const },
  histValLabel: {
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 1,
  },
});
