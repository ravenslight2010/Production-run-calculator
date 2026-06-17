import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stepper } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useRun, computeDoughSupply, liveFreezerMin, PACKAGING_FIELDS } from "@/context/RunContext";
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
  const freezerPct = freezerTime > 0 ? Math.min(freezerMin / freezerTime, 1) : 0;
  const freezerDone = freezerRemaining <= 0;
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
        {/* ─── Current Progress card ─── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>
              CURRENT PROGRESS
            </Text>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setAutoTrack(!autoTrack);
              }}
              style={({ pressed }) => [
                styles.autoPill,
                {
                  backgroundColor: autoTrack ? colors.primary + "1a" : colors.secondary,
                  borderColor: autoTrack ? colors.primary + "80" : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather
                name="zap"
                size={11}
                color={autoTrack ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.autoPillText,
                  { color: autoTrack ? colors.primary : colors.mutedForeground },
                ]}
              >
                {autoTrack ? "Auto" : "Manual"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.cardBody}>
            {autoTrack ? (
              <Text style={[styles.autoHint, { color: colors.mutedForeground }]}>
                Skids &amp; cases update automatically from run time. Tap a stepper to take
                over for 10 min.
              </Text>
            ) : null}

            {/* Steppers */}
            <Stepper
              label="Total Skids Completed"
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
              label="Cases on Current Skid"
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

            {/* Skid nearly full nudge */}
            {skidNearlyFull ? (
              <View style={[styles.skidWarn, { backgroundColor: colors.warning + "22", borderColor: colors.warning + "4d" }]}>
                <Feather name="alert-triangle" size={14} color={colors.warning} />
                <Text style={[styles.skidWarnText, { color: colors.warning }]}>
                  Skid nearly full — {casesPerSkid - run.progress.casesOnCurrentSkid} case
                  {casesPerSkid - run.progress.casesOnCurrentSkid !== 1 ? "s" : ""} to go
                </Text>
              </View>
            ) : null}

            {/* Skid Done quick action */}
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
                {
                  backgroundColor: colors.success + "22",
                  borderColor: colors.success + "66",
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={[styles.skidDoneText, { color: colors.success }]}>
                Skid Done — log &amp; reset
              </Text>
            </Pressable>

            {/* Freezer filling progress */}
            {showFreezer ? (
              <>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Text style={[styles.freezerLabel, { color: colors.mutedForeground }]}>
                  FREEZER FILLING
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: freezerDone ? colors.success : colors.primary,
                        width: `${freezerPct * 100}%`,
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.freezerStatus,
                    { color: freezerDone ? colors.success : colors.mutedForeground },
                  ]}
                >
                  {freezerDone ? "✓ Freezer full" : `${fmtTime(freezerRemaining)} until full`}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        {/* ─── Packaging settings ─── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>
              PACKAGING
            </Text>
          </View>
          <View style={styles.cardBody}>
            {PACKAGING_FIELDS.map((f) => {
              const val = ((run.settings[f.name] as string) ?? "").trim();
              return (
                <View key={f.name} style={styles.pkgRow}>
                  <Text style={[styles.pkgLabel, { color: colors.mutedForeground }]}>
                    {f.label}
                  </Text>
                  <Text
                    style={[styles.pkgValue, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {val || "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ─── Output metrics ─── */}
        <View style={styles.outputRow}>
          <View style={[styles.outputCell, { backgroundColor: colors.secondary + "66" }]}>
            <Text
              style={[styles.outputValue, { color: colors.success }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {casesCompleted}
            </Text>
            <Text style={[styles.outputLabel, { color: colors.mutedForeground }]}>
              Cases done
            </Text>
          </View>
          <View style={[styles.outputCell, { backgroundColor: colors.secondary + "66" }]}>
            <Text
              style={[styles.outputValue, { color: colors.foreground }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {calc.casesLeft}
            </Text>
            <Text style={[styles.outputLabel, { color: colors.mutedForeground }]}>
              Cases left
            </Text>
          </View>
          <View style={[styles.outputCell, { backgroundColor: colors.secondary + "66" }]}>
            <Text
              style={[styles.outputValue, { color: colors.foreground }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {supply.casesOnLine}
            </Text>
            <Text style={[styles.outputLabel, { color: colors.mutedForeground }]}>
              On line
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  card: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  cardTitle: { fontSize: 12, fontFamily: FONTS.semibold, letterSpacing: 1 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 14 },

  autoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  autoPillText: { fontSize: 11, fontFamily: FONTS.semibold },
  autoHint: { fontSize: 12, lineHeight: 16, marginTop: 4, marginBottom: 8 },

  skidWarn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  skidWarnText: { fontSize: 13, fontFamily: FONTS.semibold, flex: 1 },

  skidDoneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 12,
  },
  skidDoneText: { fontSize: 14, fontFamily: FONTS.semibold },

  divider: { height: StyleSheet.hairlineWidth, opacity: 0.5, marginTop: 14, marginBottom: 10 },
  freezerLabel: { fontSize: 11, fontFamily: FONTS.semibold, letterSpacing: 1, marginBottom: 6 },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999 },
  freezerStatus: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    textAlign: "right",
    marginTop: 6,
  },

  pkgRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 5,
  },
  pkgLabel: { fontSize: 13, fontFamily: FONTS.regular },
  pkgValue: {
    fontSize: 14,
    fontFamily: FONTS.semibold,
    fontVariant: ["tabular-nums"],
    textTransform: "capitalize",
    flexShrink: 1,
    textAlign: "right",
  },

  outputRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  outputCell: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  outputValue: {
    fontSize: 30,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
  },
  outputLabel: { fontSize: 12, marginTop: 2, fontFamily: FONTS.regular },
});
