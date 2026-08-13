import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  CardSection,
  ReadOnlyRecipe,
  Stepper,
} from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import {
  useRun,
  computeCalc,
  computeDoughSupply,
  type DoughSupplyMode,
} from "@/context/RunContext";
import RecipeSubstitutionBadge from "@/components/RecipeSubstitutionBadge";
import { useColors } from "@/hooks/useColors";

const MAX_TRAYS = 74;
const MAX_BATCHES = 3;

const SKY_500 = "#0ea5e9";
const SKY_400 = "#38bdf8";

export default function DoughScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, updateProgress, substitutions, suppressAutoTrack, autoTrack, autoSuppressUntil, resumeAutoTrack, prepPhase, startPrep, addPrepBatchDough, nextRunPrepActive, allRuns, runIndex } = useRun();
  const calc = computeCalc(run, Date.now());

  const doughSubTab: DoughSupplyMode = run.progress.subTab;
  const setDoughSubTab = (m: DoughSupplyMode) => updateProgress({ subTab: m });

  const nowMs = Date.now();
  const supply = computeDoughSupply(run, nowMs, doughSubTab);
  const supplyConfigured =
    run.settings.doughballsPerTray > 0 || run.settings.crustsPerStack > 0;
  const isCrust = doughSubTab === "crusts";

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 12, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <RecipeSubstitutionBadge
          substitutions={substitutions}
          recipes={[run.settings.doughRecipe]}
          typeValues={[]}
        />
        {/* Next-run prep handoff: shown when current run press is done and a next run is waiting */}
        {nextRunPrepActive && (() => {
          const nextRunData = allRuns[runIndex + 1];
          const nextRunName = nextRunData
            ? [nextRunData.brand, nextRunData.flavor].filter(Boolean).join(' – ') || `Run ${runIndex + 2}`
            : '';
          return (
            <View style={{ borderRadius: 8, borderWidth: 1, borderColor: '#10b981', backgroundColor: 'rgba(6,78,59,0.3)', padding: 12, marginBottom: 8 }}>
              <Text style={[styles.progressTitle, { color: '#34d399', marginBottom: 4 }]}>PREPPING FOR NEXT RUN</Text>
              {!!nextRunName && (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>{nextRunName}</Text>
              )}
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {(prepPhase?.prepBatchesDough ?? 0)} {(prepPhase?.prepBatchesDough ?? 0) === 1 ? 'batch' : 'batches'} ready for next run
              </Text>
              <Pressable
                onPress={() => { Haptics.selectionAsync(); addPrepBatchDough(); }}
                style={{ backgroundColor: '#059669', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 8 }}
              >
                <Text style={{ color: '#fff', fontFamily: FONTS.bold, fontSize: 13 }}>+1 Batch</Text>
              </Pressable>
            </View>
          );
        })()}

        {/* Shift prep section: shown while no production run is active */}
        {run.startedAt == null && (
          <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, marginBottom: 8 }}>
            <Text style={[styles.progressTitle, { color: colors.mutedForeground, marginBottom: 8 }]}>SHIFT PREP</Text>
            {prepPhase?.prepStartedAt == null ? (
              <Pressable
                onPress={() => { Haptics.selectionAsync(); startPrep(); }}
                style={{ backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' }}
              >
                <Text style={{ color: '#000', fontFamily: FONTS.bold, fontSize: 13 }}>Start Prep</Text>
              </Pressable>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {prepPhase.prepBatchesDough} {prepPhase.prepBatchesDough === 1 ? 'batch' : 'batches'} ready
                </Text>
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); addPrepBatchDough(); }}
                  style={{ backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' }}
                >
                  <Text style={{ color: '#000', fontFamily: FONTS.bold, fontSize: 13 }}>+1 Batch</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
        {/* Mode toggle */}
        {supplyConfigured ? (
          <View style={styles.supplyHeader}>
            <Text style={[styles.progressTitle, { color: colors.mutedForeground }]}>
              SUPPLY
            </Text>
            <View style={[styles.supplyToggle, { borderColor: colors.border }]}>
              {(["dough", "crusts"] as DoughSupplyMode[]).map((m) => {
                const active = doughSubTab === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setDoughSubTab(m);
                    }}
                    style={[
                      styles.supplyToggleBtn,
                      { backgroundColor: active ? colors.primary : "transparent" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.supplyToggleText,
                        { color: active ? "#000" : colors.mutedForeground },
                      ]}
                    >
                      {m === "dough" ? "Dough" : "Crusts"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
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

        {/* Staged supply steppers (mirrors web supply progress steppers) */}
        <CardSection style={styles.stepperCard}>
          <Stepper
            label={isCrust ? "Total Stacks Ready" : "Total Trays on Line"}
            value={run.progress.traysOnLine}
            onDecrement={() => {
              Haptics.selectionAsync();
              suppressAutoTrack();
              updateProgress({ traysOnLine: Math.max(0, run.progress.traysOnLine - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
              suppressAutoTrack();
              updateProgress({
                traysOnLine: Math.min(MAX_TRAYS, run.progress.traysOnLine + 1),
              });
            }}
          />
          {!isCrust && run.progress.traysOnLine >= MAX_TRAYS ? (
            <Text style={[styles.warn, { color: colors.warning ?? "#f59e0b" }]}>
              ⚠ Line full — max {MAX_TRAYS} trays
            </Text>
          ) : null}
          {!isCrust ? (
            <>
              <Stepper
                label="Batches of Dough Ready"
                value={run.progress.batchesReady}
                onDecrement={() => {
                  Haptics.selectionAsync();
                  suppressAutoTrack();
                  updateProgress({
                    batchesReady: Math.max(0, run.progress.batchesReady - 1),
                  });
                }}
                onIncrement={() => {
                  Haptics.selectionAsync();
                  suppressAutoTrack();
                  updateProgress({
                    batchesReady: Math.min(MAX_BATCHES, run.progress.batchesReady + 1),
                  });
                }}
              />
              {run.progress.batchesReady >= MAX_BATCHES ? (
                <Text style={[styles.warn, { color: colors.warning ?? "#f59e0b" }]}>
                  ⚠ Max {MAX_BATCHES} batches — avoid over-mixing
                </Text>
              ) : null}
            </>
          ) : null}
        </CardSection>

        {/* Skids / cases completed — mirrored from Packaging so the packout can be
            updated without switching tabs */}
        <Text style={[styles.progressTitle, { color: colors.mutedForeground, marginTop: 4 }]}>
          SKIDS &amp; CASES
        </Text>
        <CardSection style={styles.stepperCard}>
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
        </CardSection>

        {/* What You Need Now */}
        <Card
          title="What You Need Now"
          accentColor={isCrust ? SKY_500 : colors.primary}
          style={styles.section}
          contentStyle={styles.needContent}
        >
          <View style={styles.bigStatRow}>
            {isCrust ? (
              <>
                <BigStat
                  value={Math.round(supply.casesLeftToOpen).toString()}
                  label="Cases to open"
                  color={SKY_400}
                />
                <BigStat
                  value={Math.round(supply.stacksNeededTotal).toString()}
                  label="Stacks to stage"
                />
              </>
            ) : (
              <>
                <BigStat
                  value={supply.batchesNeeded.toFixed(2)}
                  label="Batches to mix"
                  color={colors.primary}
                />
                <BigStat
                  value={Math.round(supply.traysNeeded).toString()}
                  label="Trays needed"
                />
              </>
            )}
          </View>
          <Text style={[styles.supplyHint, { color: colors.mutedForeground }]}>
            On hand covers{" "}
            {run.settings.pizzasPerCase > 0
              ? Math.floor(supply.doughOnHand / run.settings.pizzasPerCase)
              : 0}{" "}
            cases ·{" "}
            {isCrust
              ? `${supply.casesLeftToOpen} cases to open`
              : `${supply.casesOnLine} cases on line`}
          </Text>
          {!isCrust && run.settings.doughballWeightOz > 0 && (
            <Text style={[styles.supplyHint, { color: colors.mutedForeground, marginTop: 6 }]}>
              Target ball weight:{" "}
              <Text style={{ color: colors.foreground, fontFamily: FONTS.mono }}>
                {run.settings.doughballWeightOz % 1 === 0
                  ? run.settings.doughballWeightOz.toString()
                  : run.settings.doughballWeightOz.toFixed(2)}{" "}oz
              </Text>
            </Text>
          )}
        </Card>

        {/* Dough recipe (dough mode only) */}
        {!isCrust ? (
          <Card
            title="Dough Recipe"
            icon="layers"
            accentColor="#f97316"
            style={styles.section}
          >
            <View style={styles.recipeHeadRow}>
              <Text
                style={[styles.recipeName, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {run.settings.doughRecipeName?.trim() || "Recipe"}
              </Text>
              <Text style={[styles.recipeBatches, { color: colors.mutedForeground }]}>
                <Text style={[styles.recipeBatchesNum, { color: colors.foreground }]}>
                  {supply.batchesNeeded > 0 ? supply.batchesNeeded.toFixed(2) : "—"}
                </Text>{" "}
                batches needed
              </Text>
            </View>
            {run.settings.doughballWeightOz > 0 && (
              <Text style={[styles.doughballWeight, { color: colors.mutedForeground }]}>
                <Text style={[styles.doughballWeightNum, { color: colors.foreground }]}>
                  {run.settings.doughballWeightOz % 1 === 0
                    ? run.settings.doughballWeightOz.toString()
                    : run.settings.doughballWeightOz.toFixed(2)}
                </Text>{" "}
                oz / doughball
              </Text>
            )}
            <ReadOnlyRecipe rows={run.settings.doughRecipe ?? []} scalable />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function BigStat({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.bigStat, { backgroundColor: colors.muted }]}>
      <Text
        style={[styles.bigStatValue, { color: color ?? colors.foreground }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.bigStatLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  supplyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  progressTitle: {
    fontSize: 11,
    fontFamily: FONTS.semibold,
    letterSpacing: 1,
  },
  supplyToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 999,
    padding: 2,
  },
  supplyToggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
  },
  supplyToggleText: { fontSize: 12, fontFamily: FONTS.bold },

  section: { marginTop: 12 },
  stepperCard: { paddingTop: 2, paddingBottom: 4 },

  overrideBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  overrideText: { flex: 1, fontSize: 11, fontFamily: FONTS.semibold },
  overrideResume: { fontSize: 11, fontFamily: FONTS.bold, textDecorationLine: "underline" },

  needContent: { paddingTop: 10, paddingBottom: 14 },
  bigStatRow: { flexDirection: "row", gap: 12 },
  bigStat: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  bigStatValue: {
    fontSize: 30,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  bigStatLabel: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    marginTop: 4,
    textAlign: "center",
  },
  supplyHint: { fontSize: 12, lineHeight: 16, marginTop: 12 },
  warn: { fontSize: 11, fontFamily: FONTS.semibold, marginTop: 6, marginBottom: 4 },

  recipeHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  recipeName: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONTS.mono,
  },
  recipeBatches: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    flexShrink: 0,
  },
  recipeBatchesNum: {
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
  },
  doughballWeight: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    marginBottom: 10,
  },
  doughballWeightNum: {
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
  },
});
