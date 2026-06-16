import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, MetricCard, SectionHeader, Stepper } from "@/components/UI";
import { useRun, computeDoughSupply, liveFreezerMin } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

function fmtTime(min: number): string {
  if (min <= 0) return "Done";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function PackagingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    run,
    calc,
    updateProgress,
    autoTrack,
    setAutoTrack,
    suppressAutoTrack,
  } = useRun();

  const nowMs = Date.now();
  const freezerTime = run.settings.freezerTime;
  const freezerMin = liveFreezerMin(run, nowMs);
  const freezerRemaining = Math.max(0, freezerTime - freezerMin);
  const showFreezer = run.startedAt != null && freezerTime > 0;
  const supply = computeDoughSupply(run, nowMs, run.progress.subTab);

  const casesCompleted =
    run.progress.skidsCompleted * run.settings.casesPerSkid +
    run.progress.casesOnCurrentSkid;
  const casesPerSkid = run.settings.casesPerSkid;
  const skidNearlyFull =
    casesPerSkid > 0 && casesPerSkid - run.progress.casesOnCurrentSkid <= 3 &&
    run.progress.casesOnCurrentSkid < casesPerSkid;

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Freezer countdown */}
        {showFreezer ? (
          <View style={[styles.freezerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.freezerLeft}>
              <Feather name="clock" size={16} color={colors.primary} />
              <View>
                <Text style={[styles.freezerLabel, { color: colors.mutedForeground }]}>
                  FREEZER
                </Text>
                <Text style={[styles.freezerValue, { color: colors.foreground }]}>
                  {freezerRemaining > 0
                    ? `${fmtTime(freezerRemaining)} until full`
                    : "Fully staged"}
                </Text>
              </View>
            </View>
            <View style={styles.freezerRight}>
              <Text style={[styles.freezerCases, { color: colors.primary }]}>
                {supply.casesOnLine}
              </Text>
              <Text style={[styles.freezerCasesLabel, { color: colors.mutedForeground }]}>
                cases on line
              </Text>
            </View>
          </View>
        ) : null}

        {/* Output */}
        <SectionHeader title="Output" />
        <View style={styles.metricsRow}>
          <MetricCard
            label="Cases done"
            value={casesCompleted.toString()}
            highlight={casesCompleted > 0}
            style={styles.metricThird}
          />
          <MetricCard
            label="Cases left"
            value={calc.casesLeft.toString()}
            style={styles.metricThird}
          />
          <MetricCard
            label="On line"
            value={supply.casesOnLine.toString()}
            style={styles.metricThird}
          />
        </View>

        {/* Progress steppers */}
        <View style={styles.progressHeader}>
          <Text style={[styles.progressTitle, { color: colors.mutedForeground }]}>
            PROGRESS
          </Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setAutoTrack(!autoTrack);
            }}
            style={({ pressed }) => [
              styles.autoPill,
              {
                backgroundColor: autoTrack ? colors.primary : colors.secondary,
                borderColor: autoTrack ? colors.primary : colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name="zap"
              size={12}
              color={autoTrack ? "#000" : colors.mutedForeground}
            />
            <Text
              style={[
                styles.autoPillText,
                { color: autoTrack ? "#000" : colors.mutedForeground },
              ]}
            >
              Auto {autoTrack ? "On" : "Off"}
            </Text>
          </Pressable>
        </View>
        {autoTrack ? (
          <Text style={[styles.autoHint, { color: colors.mutedForeground }]}>
            Skids &amp; cases update automatically from run time. Tap a stepper to take
            over for 10 min.
          </Text>
        ) : null}
        <CardSection>
          <Stepper
            label="Skids Completed"
            value={run.progress.skidsCompleted}
            onDecrement={() => {
              Haptics.selectionAsync();
              suppressAutoTrack();
              updateProgress({ skidsCompleted: Math.max(0, run.progress.skidsCompleted - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
              suppressAutoTrack();
              updateProgress({ skidsCompleted: run.progress.skidsCompleted + 1 });
            }}
          />
          <Stepper
            label="Cases on Skid"
            value={run.progress.casesOnCurrentSkid}
            onDecrement={() => {
              Haptics.selectionAsync();
              suppressAutoTrack();
              updateProgress({ casesOnCurrentSkid: Math.max(0, run.progress.casesOnCurrentSkid - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
              suppressAutoTrack();
              updateProgress({ casesOnCurrentSkid: run.progress.casesOnCurrentSkid + 1 });
            }}
          />
        </CardSection>

        {skidNearlyFull ? (
          <View style={[styles.skidWarn, { backgroundColor: colors.warning + "22", borderColor: colors.warning }]}>
            <Feather name="alert-triangle" size={14} color={colors.warning} />
            <Text style={[styles.skidWarnText, { color: colors.warning }]}>
              Skid nearly full — {casesPerSkid - run.progress.casesOnCurrentSkid} case
              {casesPerSkid - run.progress.casesOnCurrentSkid !== 1 ? "s" : ""} to go
            </Text>
          </View>
        ) : null}

        {/* Quick action — log the finished skid and start a fresh one */}
        <Pressable
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            suppressAutoTrack();
            updateProgress({
              skidsCompleted: run.progress.skidsCompleted + 1,
              casesOnCurrentSkid: 0,
            });
          }}
          style={({ pressed }) => [
            styles.skidDoneBtn,
            { borderColor: colors.success, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="check-circle" size={16} color={colors.success} />
          <Text style={[styles.skidDoneText, { color: colors.success }]}>
            Skid Done — log &amp; reset
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  freezerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
  },
  freezerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  freezerLabel: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 1 },
  freezerValue: { fontSize: 15, fontWeight: "700" as const, marginTop: 2 },
  freezerRight: { alignItems: "flex-end" },
  freezerCases: { fontSize: 22, fontWeight: "700" as const, fontVariant: ["tabular-nums"] },
  freezerCasesLabel: { fontSize: 11, marginTop: 1 },

  metricsRow: { flexDirection: "row", gap: 10 },
  metricThird: { flex: 1 },

  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 10,
  },
  progressTitle: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 1,
  },
  autoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  autoPillText: { fontSize: 12, fontWeight: "700" as const },
  autoHint: { fontSize: 12, lineHeight: 16, marginBottom: 10, marginTop: -2 },

  skidWarn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  skidWarnText: { fontSize: 13, fontWeight: "600" as const, flex: 1 },

  skidDoneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
  },
  skidDoneText: { fontSize: 15, fontWeight: "700" as const },
});
