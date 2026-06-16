import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CardSection,
  MetricCard,
  ReadOnlyRecipe,
  SectionHeader,
  Stepper,
} from "@/components/UI";
import {
  useRun,
  computeDoughSupply,
  type DoughSupplyMode,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

const MAX_TRAYS = 74;
const MAX_BATCHES = 3;

export default function DoughScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, calc, updateProgress } = useRun();

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
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
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

        {/* Staged supply steppers */}
        <SectionHeader title="Staged Supply" />
        <CardSection>
          <Stepper
            label={isCrust ? "Total Stacks Ready" : "Total Trays on Line"}
            value={run.progress.traysOnLine}
            onDecrement={() => {
              Haptics.selectionAsync();
              updateProgress({ traysOnLine: Math.max(0, run.progress.traysOnLine - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
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
                  updateProgress({
                    batchesReady: Math.max(0, run.progress.batchesReady - 1),
                  });
                }}
                onIncrement={() => {
                  Haptics.selectionAsync();
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

        {/* What You Need Now */}
        <SectionHeader title="What You Need Now" />
        <CardSection>
          <View style={styles.metricsRow}>
            {isCrust ? (
              <>
                <MetricCard
                  label="Cases to open"
                  value={Math.round(supply.casesLeftToOpen).toString()}
                  highlight={supply.casesLeftToOpen > 0}
                  style={styles.metric}
                />
                <MetricCard
                  label="Stacks to stage"
                  value={Math.round(supply.stacksNeededTotal).toString()}
                  highlight={supply.stacksNeededTotal > 0}
                  style={styles.metric}
                />
              </>
            ) : (
              <>
                <MetricCard
                  label="Batches to mix"
                  value={supply.batchesNeeded.toFixed(2)}
                  highlight={supply.batchesNeeded > 0}
                  style={styles.metric}
                />
                <MetricCard
                  label="Trays needed"
                  value={Math.round(supply.traysNeeded).toString()}
                  highlight={supply.traysNeeded > 0}
                  style={styles.metric}
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
        </CardSection>

        {/* Dough recipe (dough mode only) */}
        {!isCrust ? (
          <>
            <SectionHeader title="Dough Recipe" />
            {run.settings.doughRecipeName?.trim() ? (
              <Text style={[styles.recipeName, { color: colors.mutedForeground }]}>
                {run.settings.doughRecipeName}
              </Text>
            ) : null}
            <CardSection style={{ paddingVertical: 14 }}>
              <ReadOnlyRecipe rows={run.settings.doughRecipe ?? []} />
            </CardSection>
          </>
        ) : null}
      </ScrollView>
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
    marginTop: 8,
    marginBottom: 4,
  },
  progressTitle: {
    fontSize: 11,
    fontWeight: "600" as const,
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
  supplyToggleText: { fontSize: 12, fontWeight: "700" as const },
  supplyHint: { fontSize: 12, lineHeight: 16, marginTop: 12 },
  warn: { fontSize: 11, fontWeight: "600", marginTop: 6 },

  metricsRow: { flexDirection: "row", gap: 10 },
  metric: { flex: 1 },
  recipeName: {
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 6,
  },
});
