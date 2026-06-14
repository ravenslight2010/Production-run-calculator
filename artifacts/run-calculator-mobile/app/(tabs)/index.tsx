import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BatchCard, CardSection, MetricCard, SectionHeader, Stepper } from "@/components/UI";
import { useRun, runLabel, type Stoppage } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

function fmtTime(min: number): string {
  if (min <= 0) return "Done";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STOPPAGE_TYPES: { type: Stoppage["type"]; label: string; color: string }[] = [
  { type: "jam", label: "Jam", color: "#ff3b30" },
  { type: "changeover", label: "Changeover", color: "#ff9f0a" },
  { type: "break", label: "Break", color: "#30d158" },
  { type: "other", label: "Other", color: "#636366" },
];

export default function CalculatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    run, calc, tick,
    runIndex, runCount, allRuns,
    activeStoppage, startRun, endRun,
    updateProgress, addStoppage, endActiveStoppage,
    addRun, switchRun, deleteRun,
  } = useRun();
  const [showModal, setShowModal] = useState(false);
  const [showRunPicker, setShowRunPicker] = useState(false);

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const label = runLabel(run, runIndex);

  const batches = [
    run.settings.sauceOzPerPizza > 0 && calc.sauceLbs > 0
      ? { name: "Sauce", batches: calc.sauceBatches, lbs: calc.sauceLbs }
      : null,
    run.settings.app1Type
      ? { name: run.settings.app1Type, batches: calc.app1Batches, lbs: calc.app1Lbs }
      : null,
    run.settings.app2Type
      ? { name: run.settings.app2Type, batches: calc.app2Batches, lbs: calc.app2Lbs }
      : null,
    run.settings.app3Type
      ? { name: run.settings.app3Type, batches: calc.app3Batches, lbs: calc.app3Lbs }
      : null,
    run.settings.app4Type
      ? { name: run.settings.app4Type, batches: calc.app4Batches, lbs: calc.app4Lbs }
      : null,
    run.settings.pep1Type
      ? { name: run.settings.pep1Type, batches: calc.pep1Batches, lbs: calc.pep1Lbs }
      : null,
    run.settings.pep2Type
      ? { name: run.settings.pep2Type, batches: calc.pep2Batches, lbs: calc.pep2Lbs }
      : null,
    run.settings.doughBatchLbs > 0
      ? { name: "Dough", batches: calc.doughBatches, lbs: calc.doughLbs }
      : null,
  ].filter(Boolean) as { name: string; batches: number; lbs: number }[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Run navigator */}
        <View style={[styles.runNav, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => switchRun(runIndex - 1)}
            disabled={runIndex === 0}
            style={({ pressed }) => [styles.navBtn, { opacity: runIndex === 0 ? 0.25 : pressed ? 0.5 : 1 }]}
          >
            <Feather name="chevron-left" size={20} color={colors.foreground} />
          </Pressable>

          <Pressable onPress={() => setShowRunPicker(true)} style={styles.navCenter}>
            <Text style={[styles.navLabel, { color: colors.foreground }]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={[styles.navSub, { color: colors.mutedForeground }]}>
              Run {runIndex + 1} of {runCount}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => switchRun(runIndex + 1)}
            disabled={runIndex === runCount - 1}
            style={({ pressed }) => [styles.navBtn, { opacity: runIndex === runCount - 1 ? 0.25 : pressed ? 0.5 : 1 }]}
          >
            <Feather name="chevron-right" size={20} color={colors.foreground} />
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              addRun();
            }}
            style={({ pressed }) => [styles.navAddBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="plus" size={16} color="#000" />
          </Pressable>
        </View>

        {/* Start/Stop row */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {run.isRunning && (
              <Text style={[styles.elapsed, { color: colors.mutedForeground }]}>
                {fmtElapsed(calc.netElapsedSec)} net ·{" "}
                {calc.totalDowntimeSec > 0
                  ? `${fmtElapsed(calc.totalDowntimeSec)} down`
                  : "no downtime"}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              run.isRunning ? endRun() : startRun();
            }}
            style={({ pressed }) => [
              styles.toggleBtn,
              {
                backgroundColor: run.isRunning ? "#ef4444" : colors.success,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={styles.toggleText}>
              {run.isRunning ? "■ STOP" : "▶ START"}
            </Text>
          </Pressable>
        </View>

        {/* Active stoppage banner */}
        {activeStoppage ? (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              endActiveStoppage();
            }}
            style={[styles.stoppageBanner, { backgroundColor: colors.warning }]}
          >
            <Feather name="pause-circle" size={16} color="#000" />
            <Text style={styles.stoppageBannerText}>
              {activeStoppage.type.toUpperCase()} · TAP TO END
            </Text>
          </Pressable>
        ) : null}

        {/* Carry-over done */}
        {run.settings.casesNeeded > 0 && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              updateProgress({ carryOverDone: !run.progress.carryOverDone });
            }}
            style={[
              styles.carryOverRow,
              {
                borderColor: run.progress.carryOverDone ? colors.success : colors.border,
                backgroundColor: colors.card,
              },
            ]}
          >
            <Feather
              name={run.progress.carryOverDone ? "check-square" : "square"}
              size={18}
              color={run.progress.carryOverDone ? colors.success : colors.mutedForeground}
            />
            <Text style={[styles.carryOverText, { color: run.progress.carryOverDone ? colors.success : colors.mutedForeground }]}>
              Carry-over applied
            </Text>
          </Pressable>
        )}

        {/* Live metrics */}
        <SectionHeader title="Live" />
        <View style={styles.metricsRow}>
          <MetricCard
            label="Cases Left"
            value={calc.casesLeft.toString()}
            highlight={calc.casesLeft > 0}
            style={styles.metricBig}
          />
          <View style={styles.metricCol}>
            <MetricCard
              label="PPM"
              value={calc.ppm > 0 ? calc.ppm.toFixed(1) : "—"}
            />
            <MetricCard
              label="Est. Done"
              value={
                calc.minutesRemaining != null
                  ? fmtTime(calc.minutesRemaining)
                  : "—"
              }
              sublabel={
                calc.estCompletionMs ? `@ ${fmtClock(calc.estCompletionMs)}` : undefined
              }
            />
          </View>
        </View>

        {/* Material batches */}
        {batches.length > 0 ? (
          <>
            <SectionHeader title="Material Needs" />
            <View style={styles.batchGrid}>
              {batches.map((b) => (
                <BatchCard
                  key={b.name}
                  name={b.name}
                  batches={b.batches}
                  lbs={b.lbs}
                  style={styles.batchItem}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* Progress steppers */}
        <SectionHeader title="Progress" />
        <CardSection>
          <Stepper
            label="Skids Completed"
            value={run.progress.skidsCompleted}
            onDecrement={() => {
              Haptics.selectionAsync();
              updateProgress({ skidsCompleted: Math.max(0, run.progress.skidsCompleted - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
              updateProgress({ skidsCompleted: run.progress.skidsCompleted + 1 });
            }}
          />
          <Stepper
            label="Cases on Skid"
            value={run.progress.casesOnCurrentSkid}
            onDecrement={() => {
              Haptics.selectionAsync();
              updateProgress({ casesOnCurrentSkid: Math.max(0, run.progress.casesOnCurrentSkid - 1) });
            }}
            onIncrement={() => {
              Haptics.selectionAsync();
              updateProgress({ casesOnCurrentSkid: run.progress.casesOnCurrentSkid + 1 });
            }}
          />
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

        {/* Log stoppage button */}
        {run.isRunning && !activeStoppage ? (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowModal(true);
            }}
            style={({ pressed }) => [
              styles.stoppageBtn,
              { borderColor: colors.warning, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="pause-circle" size={18} color={colors.warning} />
            <Text style={[styles.stoppageBtnText, { color: colors.warning }]}>
              Log Stoppage
            </Text>
          </Pressable>
        ) : null}

        {/* Run notes */}
        {run.settings.notes ? (
          <View style={[styles.notesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.notesLabel, { color: colors.mutedForeground }]}>NOTES</Text>
            <Text style={[styles.notesText, { color: colors.foreground }]}>
              {run.settings.notes}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <StoppageModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onAdd={(type) => {
          addStoppage(type);
          setShowModal(false);
        }}
      />

      <RunPickerModal
        visible={showRunPicker}
        onClose={() => setShowRunPicker(false)}
        runs={allRuns}
        currentIndex={runIndex}
        onSelect={(i) => {
          switchRun(i);
          setShowRunPicker(false);
        }}
        onDelete={(i) => {
          Alert.alert(
            "Delete Run",
            `Delete "${runLabel(allRuns[i], i)}"?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  deleteRun(i);
                  setShowRunPicker(false);
                },
              },
            ],
          );
        }}
      />
    </View>
  );
}

function StoppageModal({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (type: Stoppage["type"]) => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Log Stoppage</Text>
          <View style={styles.typeGrid}>
            {STOPPAGE_TYPES.map((t) => (
              <Pressable
                key={t.type}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onAdd(t.type);
                }}
                style={({ pressed }) => [
                  styles.typeBtn,
                  { backgroundColor: t.color, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Text style={styles.typeBtnText}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RunPickerModal({
  visible,
  onClose,
  runs,
  currentIndex,
  onSelect,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  runs: import("@/context/RunContext").RunState[];
  currentIndex: number;
  onSelect: (i: number) => void;
  onDelete: (i: number) => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Switch Run</Text>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {runs.map((r, i) => {
              const lbl = runLabel(r, i);
              const isCurrent = i === currentIndex;
              return (
                <View key={r.id} style={styles.pickerRow}>
                  <Pressable
                    onPress={() => onSelect(i)}
                    style={({ pressed }) => [
                      styles.pickerItem,
                      {
                        backgroundColor: isCurrent ? colors.primary + "22" : colors.secondary,
                        borderColor: isCurrent ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={styles.pickerItemInner}>
                      {isCurrent ? (
                        <Feather name="check" size={14} color={colors.primary} />
                      ) : (
                        <View style={{ width: 14 }} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerLabel, { color: isCurrent ? colors.primary : colors.foreground }]}>
                          {lbl}
                        </Text>
                        <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
                          {r.settings.casesNeeded > 0 ? `${r.settings.casesNeeded} cases` : "Not configured"}
                          {r.isRunning ? "  ● Running" : ""}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                  {runs.length > 1 && (
                    <Pressable
                      onPress={() => onDelete(i)}
                      style={({ pressed }) => [styles.pickerDelete, { opacity: pressed ? 0.5 : 1 }]}
                    >
                      <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  runNav: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    overflow: "hidden",
  },
  navBtn: { padding: 12 },
  navCenter: { flex: 1, alignItems: "center", paddingVertical: 10 },
  navLabel: { fontSize: 15, fontWeight: "600" as const, textAlign: "center" },
  navSub: { fontSize: 11, marginTop: 1 },
  navAddBtn: {
    margin: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    minHeight: 44,
  },
  headerLeft: { flex: 1, marginRight: 12 },
  elapsed: { fontSize: 12, marginTop: 2 },
  toggleBtn: { borderRadius: 20, paddingVertical: 9, paddingHorizontal: 18 },
  toggleText: { color: "#fff", fontWeight: "700" as const, fontSize: 13, letterSpacing: 0.3 },

  stoppageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    justifyContent: "center",
  },
  stoppageBannerText: { color: "#000", fontWeight: "700" as const, fontSize: 13 },

  carryOverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
  },
  carryOverText: { fontSize: 14, fontWeight: "500" as const },

  metricsRow: { flexDirection: "row", gap: 10 },
  metricBig: { flex: 1.3 },
  metricCol: { flex: 1, gap: 10 },

  batchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  batchItem: { flexBasis: "47%", flexGrow: 1 },

  stoppageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    justifyContent: "center",
    marginTop: 16,
  },
  stoppageBtnText: { fontSize: 15, fontWeight: "600" as const },

  notesCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 16,
    gap: 6,
  },
  notesLabel: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 0.8 },
  notesText: { fontSize: 14, lineHeight: 20 },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700" as const, marginBottom: 20, textAlign: "center" },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
  },
  typeBtn: {
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 20,
    minWidth: "45%",
    alignItems: "center",
  },
  typeBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 16 },

  pickerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  pickerItem: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  pickerItemInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  pickerLabel: { fontSize: 15, fontWeight: "600" as const },
  pickerSub: { fontSize: 12, marginTop: 2 },
  pickerDelete: { padding: 12 },
});
