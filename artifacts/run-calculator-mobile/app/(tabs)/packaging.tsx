import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stepper } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useRun, computeCalc, computeDoughSupply, liveFreezerMin, runLabel, PACKAGING_FIELDS } from "@/context/RunContext";
import type { RunState } from "@/context/RunContext";
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
    allRuns,
    updateProgress,
    updateProgressForRun,
    autoTrack,
    setAutoTrack,
    suppressAutoTrack,
    autoSuppressUntil,
    resumeAutoTrack,
  } = useRun();

  const nowMs = Date.now();
  const calc = computeCalc(run, nowMs);

  // ── Draining run (transition view) ─────────────────────────────────────────
  // When a run ends and the next begins, the just-ended run's pizzas keep
  // exiting the freezer tunnel for `freezerTime` more minutes. Pick the
  // most-recently-ended run (other than the active one) whose freezer is still
  // draining AND that still has unpackaged cases, so the operator can keep
  // logging it. Manual logging only — we never auto-track a non-active run.
  const drainingRun: RunState | null = (() => {
    let best: RunState | undefined;
    for (const r of allRuns) {
      if (r.id === run.id) continue;
      if (r.endedAt == null) continue;
      if (!best || r.endedAt > (best.endedAt ?? 0)) best = r;
    }
    if (!best || best.endedAt == null) return null;
    const fT = best.settings.freezerTime;
    if (fT <= 0) return null;
    if (nowMs >= best.endedAt + fT * 60000) return null; // freezer fully empty
    const dCalc = computeCalc(best, nowMs);
    if (best.settings.casesNeeded > 0 && dCalc.casesLeft <= 0) return null; // all packaged
    return best;
  })();

  const dr = drainingRun;
  const drCalc = dr ? computeCalc(dr, nowMs) : null;
  const drCasesPerSkid = dr?.settings.casesPerSkid ?? 0;
  // Mirror web's draining-panel increment caps so logging behaves identically
  // across platforms: skids cap at floor(casesNeeded / casesPerSkid), cases on
  // the current skid cap at casesPerSkid.
  const drCasesNeeded = dr?.settings.casesNeeded ?? 0;
  const drMaxSkids = drCasesPerSkid > 0 ? Math.floor(drCasesNeeded / drCasesPerSkid) : undefined;
  const drMaxCasesOnSkid = drCasesPerSkid > 0 ? drCasesPerSkid : undefined;
  const drCasesDone = dr
    ? dr.progress.skidsCompleted * drCasesPerSkid + dr.progress.casesOnCurrentSkid
    : 0;
  const drFreezerTime = dr?.settings.freezerTime ?? 0;
  const drFreezerMs = drFreezerTime * 60000;
  const drRemainMs =
    dr && dr.endedAt != null
      ? Math.max(0, dr.endedAt + drFreezerMs - nowMs)
      : 0;
  const drPct = drFreezerMs > 0 ? Math.min(1 - drRemainMs / drFreezerMs, 1) : 0;
  const drDone = drRemainMs === 0;
  const drMM = Math.floor(drRemainMs / 60000);
  const drSS = Math.floor((drRemainMs % 60000) / 1000);
  const drSkidNearlyFull =
    !!dr &&
    drCasesPerSkid > 0 &&
    drCasesPerSkid - dr.progress.casesOnCurrentSkid <= 3 &&
    dr.progress.casesOnCurrentSkid < drCasesPerSkid;
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
        {/* ─── Finishing — Freezer Draining (just-ended run still exiting freezer) ─── */}
        {dr ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: (colors.warning ?? "#f59e0b") + "66" },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.warning ?? "#f59e0b" }]}>
                FINISHING — FREEZER DRAINING
              </Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={[styles.drainName, { color: colors.foreground }]} numberOfLines={1}>
                {runLabel(dr, allRuns.indexOf(dr))}
              </Text>
              <Text style={[styles.drainHint, { color: colors.mutedForeground }]}>
                Finished pizzas are still exiting the freezer. Log skids &amp; cases as they come
                off.
              </Text>

              <Stepper
                label="Total Skids Completed"
                value={dr.progress.skidsCompleted}
                onDecrement={() => {
                  Haptics.selectionAsync();
                  updateProgressForRun(dr.id, {
                    skidsCompleted: Math.max(0, dr.progress.skidsCompleted - 1),
                  });
                }}
                onIncrement={() => {
                  if (drMaxSkids !== undefined && dr.progress.skidsCompleted >= drMaxSkids) return;
                  Haptics.selectionAsync();
                  updateProgressForRun(dr.id, {
                    skidsCompleted: dr.progress.skidsCompleted + 1,
                  });
                }}
              />
              <Stepper
                label="Cases on Current Skid"
                value={dr.progress.casesOnCurrentSkid}
                onDecrement={() => {
                  Haptics.selectionAsync();
                  updateProgressForRun(dr.id, {
                    casesOnCurrentSkid: Math.max(0, dr.progress.casesOnCurrentSkid - 1),
                  });
                }}
                onIncrement={() => {
                  if (drMaxCasesOnSkid !== undefined && dr.progress.casesOnCurrentSkid >= drMaxCasesOnSkid) return;
                  Haptics.selectionAsync();
                  updateProgressForRun(dr.id, {
                    casesOnCurrentSkid: dr.progress.casesOnCurrentSkid + 1,
                  });
                }}
              />

              {drSkidNearlyFull ? (
                <View
                  style={[
                    styles.skidWarn,
                    { backgroundColor: colors.warning + "22", borderColor: colors.warning + "4d" },
                  ]}
                >
                  <Feather name="alert-triangle" size={14} color={colors.warning} />
                  <Text style={[styles.skidWarnText, { color: colors.warning }]}>
                    Skid nearly full — {drCasesPerSkid - dr.progress.casesOnCurrentSkid} case
                    {drCasesPerSkid - dr.progress.casesOnCurrentSkid !== 1 ? "s" : ""} to go
                  </Text>
                </View>
              ) : null}

              <Pressable
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  updateProgressForRun(dr.id, {
                    skidsCompleted: dr.progress.skidsCompleted + 1,
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

              {/* Cases done / left for the draining run */}
              <View style={styles.drainMetrics}>
                <View style={[styles.drainCell, { backgroundColor: colors.secondary + "66" }]}>
                  <Text
                    style={[styles.drainValue, { color: colors.success }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {drCasesDone}
                  </Text>
                  <Text style={[styles.drainLabel, { color: colors.mutedForeground }]}>
                    Cases done
                  </Text>
                </View>
                <View style={[styles.drainCell, { backgroundColor: colors.secondary + "66" }]}>
                  <Text
                    style={[styles.drainValue, { color: colors.foreground }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {drCalc?.casesLeft ?? 0}
                  </Text>
                  <Text style={[styles.drainLabel, { color: colors.mutedForeground }]}>
                    Cases left
                  </Text>
                </View>
              </View>

              {/* Freezer emptying countdown */}
              {drFreezerTime > 0 ? (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <Text style={[styles.freezerLabel, { color: colors.mutedForeground }]}>
                    FREEZER EMPTYING
                  </Text>
                  <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          backgroundColor: drDone ? colors.success : colors.warning ?? "#f59e0b",
                          width: `${drPct * 100}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.freezerStatus,
                      { color: drDone ? colors.success : colors.warning ?? "#f59e0b" },
                    ]}
                  >
                    {drDone
                      ? "✓ Freezer empty"
                      : `Draining — ${String(drMM).padStart(2, "0")}:${String(drSS).padStart(2, "0")} left`}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        ) : null}

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

            {/* Manual override banner (mirrors web "Resume now") */}
            {autoTrack && autoSuppressUntil > nowMs ? (
              <View
                style={[
                  styles.overrideBanner,
                  { backgroundColor: (colors.warning ?? "#f59e0b") + "1a", borderColor: (colors.warning ?? "#f59e0b") + "40" },
                ]}
              >
                <Text style={[styles.overrideText, { color: colors.warning ?? "#f59e0b" }]}>
                  Manual override active · auto resumes in ~{Math.ceil((autoSuppressUntil - nowMs) / 60000)} min
                </Text>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    resumeAutoTrack();
                  }}
                  hitSlop={8}
                >
                  <Text style={[styles.overrideResume, { color: colors.warning ?? "#f59e0b" }]}>Resume now</Text>
                </Pressable>
              </View>
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
            {(() => {
              const isCartoned =
                ((run.settings.cartoned as string) ?? "").trim().toLowerCase() === "yes";
              return (
                <View
                  style={[
                    styles.pkgBadge,
                    {
                      backgroundColor: isCartoned ? colors.primary + "26" : colors.secondary,
                      borderColor: isCartoned ? colors.primary + "66" : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pkgBadgeText,
                      { color: isCartoned ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {isCartoned ? "Cartoned" : "Labeled"}
                  </Text>
                </View>
              );
            })()}
            {((run.settings.cartoned as string) ?? "").trim().toLowerCase() === "yes" && (
              <View style={styles.pkgRow}>
                <Text style={[styles.pkgLabel, { color: colors.mutedForeground }]}>
                  Cartons / Case
                </Text>
                <Text
                  style={[styles.pkgValue, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {Number(run.settings.cartonsPerCase) > 0
                    ? Number(run.settings.cartonsPerCase).toLocaleString()
                    : "—"}
                </Text>
              </View>
            )}
            {PACKAGING_FIELDS.filter((f) => f.name !== "cartoned").map((f) => {
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

        {calc.extraCases > 0 && (
          <View
            style={[
              styles.extraCasesCell,
              { backgroundColor: colors.success + "22", borderColor: colors.success + "66" },
            ]}
          >
            <Text
              style={[styles.outputValue, { color: colors.success }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              +{calc.extraCases}
            </Text>
            <Text style={[styles.outputLabel, { color: colors.mutedForeground }]}>
              Extra cases beyond target
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  extraCasesCell: {
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
  },

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

  drainName: { fontSize: 16, fontFamily: FONTS.semibold, marginTop: 2 },
  drainHint: { fontSize: 12, lineHeight: 16, marginTop: 4, marginBottom: 8 },
  drainMetrics: { flexDirection: "row", gap: 12, marginTop: 14 },
  drainCell: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  drainValue: {
    fontSize: 26,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
  },
  drainLabel: { fontSize: 12, marginTop: 2, fontFamily: FONTS.regular },

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

  overrideBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
  },
  overrideText: { flex: 1, fontSize: 11, fontFamily: FONTS.semibold },
  overrideResume: { fontSize: 11, fontFamily: FONTS.bold, textDecorationLine: "underline" },

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

  pkgBadge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  pkgBadgeText: {
    fontSize: 12,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
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
