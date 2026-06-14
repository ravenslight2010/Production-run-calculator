import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BatchCard, CardSection, MetricCard, SectionHeader, Stepper } from "@/components/UI";
import {
  useRun,
  computeDoughSupply,
  type DoughSupplyMode,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

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
        {/* Dough material need */}
        {run.settings.doughBatchLbs > 0 ? (
          <>
            <SectionHeader title="Dough Needs" />
            <BatchCard
              name="Dough"
              batches={calc.doughBatches}
              lbs={calc.doughLbs}
            />
          </>
        ) : null}

        {/* Dough / crust supply tracking */}
        {supplyConfigured ? (
          <>
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
            <CardSection>
              <View style={styles.supplyStatusRow}>
                <Text style={[styles.supplyStatusLabel, { color: colors.mutedForeground }]}>
                  Status
                </Text>
                {(() => {
                  const shortInt = Math.ceil(supply.doughShortCases);
                  const bufferInt = Math.floor(supply.buffer);
                  if (shortInt > 0) {
                    return (
                      <View style={[styles.supplyPill, { backgroundColor: colors.destructive }]}>
                        <Feather name="alert-triangle" size={12} color="#fff" />
                        <Text style={styles.supplyPillText}>
                          Short {shortInt} case{shortInt !== 1 ? "s" : ""}
                        </Text>
                      </View>
                    );
                  }
                  if (bufferInt > 0) {
                    return (
                      <View style={[styles.supplyPill, { backgroundColor: colors.success }]}>
                        <Feather name="check" size={12} color="#fff" />
                        <Text style={styles.supplyPillText}>
                          {bufferInt} case{bufferInt !== 1 ? "s" : ""} ahead
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <View style={[styles.supplyPill, { backgroundColor: colors.secondary }]}>
                      <Text style={[styles.supplyPillText, { color: colors.foreground }]}>
                        Balanced
                      </Text>
                    </View>
                  );
                })()}
              </View>
              <View style={styles.metricsRow}>
                <MetricCard
                  label={doughSubTab === "crusts" ? "Stacks to Stage" : "Trays to Stage"}
                  value={supply.stacksNeededTotal.toString()}
                  highlight={supply.stacksNeededTotal > 0}
                  style={styles.metricBig}
                />
                <View style={styles.metricCol}>
                  <MetricCard label="Cases Left to Run" value={supply.casesLeftToRun.toString()} />
                  <MetricCard
                    label={doughSubTab === "crusts" ? "Cases to Open" : "Cases on Line"}
                    value={(doughSubTab === "crusts"
                      ? supply.casesLeftToOpen
                      : supply.casesOnLine
                    ).toString()}
                  />
                </View>
              </View>
              <Text style={[styles.supplyHint, { color: colors.mutedForeground }]}>
                On hand covers{" "}
                {run.settings.pizzasPerCase > 0
                  ? Math.floor(supply.doughOnHand / run.settings.pizzasPerCase)
                  : 0}{" "}
                cases ·{" "}
                {doughSubTab === "crusts"
                  ? `${supply.casesLeftToOpen} cases to open`
                  : `${supply.casesOnLine} cases on line`}
              </Text>
            </CardSection>
          </>
        ) : null}

        {/* Progress steppers */}
        <SectionHeader title="Staged Supply" />
        <CardSection>
          <Stepper
            label="Trays on Line"
            value={run.progress.traysOnLine}
            onDecrement={() => {
              Haptics.selectionAsync();
              updateProgress({ traysOnLine: Math.max(0, run.progress.traysOnLine - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
              updateProgress({ traysOnLine: run.progress.traysOnLine + 1 });
            }}
          />
          <Stepper
            label="Dough Batches Ready"
            value={run.progress.batchesReady}
            onDecrement={() => {
              Haptics.selectionAsync();
              updateProgress({ batchesReady: Math.max(0, run.progress.batchesReady - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
              updateProgress({ batchesReady: run.progress.batchesReady + 1 });
            }}
          />
        </CardSection>
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
    marginTop: 22,
    marginBottom: 10,
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
  supplyStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  supplyStatusLabel: { fontSize: 13, fontWeight: "500" as const },
  supplyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  supplyPillText: { color: "#fff", fontSize: 12, fontWeight: "700" as const },
  supplyHint: { fontSize: 12, lineHeight: 16, marginTop: 12 },

  metricsRow: { flexDirection: "row", gap: 10 },
  metricBig: { flex: 1.3 },
  metricCol: { flex: 1, gap: 10 },
});
