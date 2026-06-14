import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
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
import { useRun, type Stoppage } from "@/context/RunContext";
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
    activeStoppage, startRun, endRun,
    updateProgress, addStoppage, endActiveStoppage,
  } = useRun();
  const [showModal, setShowModal] = useState(false);

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const batches = [
    calc.sauceLbs > 0
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
        {/* Header row */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.runLabel, { color: colors.foreground }]}>
              {run.label}
            </Text>
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
              value={calc.ppm > 0 ? calc.ppm.toFixed(0) : "—"}
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
            label="Cases on Current Skid"
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
            label="Batches Ready"
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
      </ScrollView>

      <StoppageModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onAdd={(type) => {
          addStoppage(type);
          setShowModal(false);
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
            Log Stoppage
          </Text>
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  headerLeft: { flex: 1, marginRight: 12 },
  runLabel: { fontSize: 22, fontWeight: "700" as const },
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
});
