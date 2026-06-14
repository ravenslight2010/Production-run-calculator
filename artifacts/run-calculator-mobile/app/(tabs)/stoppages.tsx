import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRun, runLabel, type Stoppage } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

const TYPE_COLORS: Record<Stoppage["type"], string> = {
  jam: "#ff3b30",
  changeover: "#ff9f0a",
  break: "#30d158",
  other: "#636366",
};

const STOPPAGE_TYPES: { type: Stoppage["type"]; label: string }[] = [
  { type: "jam", label: "Jam" },
  { type: "changeover", label: "Changeover" },
  { type: "break", label: "Break" },
  { type: "other", label: "Other" },
];

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${min} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function StoppageRow({ stoppage, tick }: { stoppage: Stoppage; tick: number }) {
  const colors = useColors();
  const isActive = stoppage.endedAt == null;
  const durationSec = isActive
    ? (Date.now() - stoppage.startedAt) / 1000
    : (stoppage.endedAt! - stoppage.startedAt) / 1000;
  const color = TYPE_COLORS[stoppage.type];

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: isActive ? color : colors.border,
          borderWidth: isActive ? 1.5 : 1,
        },
      ]}
    >
      <View style={[styles.typeTag, { backgroundColor: color }]}>
        <Text style={styles.typeTagText}>{stoppage.type.toUpperCase()}</Text>
      </View>
      <View style={styles.rowMid}>
        <Text style={[styles.rowTime, { color: colors.foreground }]}>
          {fmtTime(stoppage.startedAt)}
          {stoppage.endedAt ? ` → ${fmtTime(stoppage.endedAt)}` : ""}
        </Text>
        {stoppage.reason ? (
          <Text style={[styles.rowReason, { color: colors.mutedForeground }]}>
            {stoppage.reason}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        {isActive ? (
          <View style={[styles.activeDot, { backgroundColor: color }]} />
        ) : null}
        <Text style={[styles.duration, { color: isActive ? color : colors.mutedForeground }]}>
          {fmtDuration(durationSec)}
        </Text>
      </View>
    </View>
  );
}

export default function StoppagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, runIndex, tick, activeStoppage, addStoppage, addPastStoppage, endActiveStoppage } =
    useRun();
  const [showModal, setShowModal] = useState(false);

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const label = runLabel(run, runIndex);
  const sorted = [...run.stoppages].reverse();
  const totalDowntimeSec = run.stoppages
    .filter((s) => s.endedAt != null)
    .reduce((acc, s) => acc + (s.endedAt! - s.startedAt) / 1000, 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Run label chip */}
      <View style={[styles.runChip, { backgroundColor: colors.card, borderColor: colors.border, marginTop: webTop + 12 }]}>
        <Feather name="layers" size={13} color={colors.mutedForeground} />
        <Text style={[styles.runChipText, { color: colors.mutedForeground }]}>
          {label}
        </Text>
        {run.isRunning && (
          <View style={[styles.runDot, { backgroundColor: colors.success }]} />
        )}
      </View>

      {/* Active stoppage card */}
      {activeStoppage ? (
        <View
          style={[
            styles.activeCard,
            {
              backgroundColor: colors.card,
              borderColor: TYPE_COLORS[activeStoppage.type],
              marginHorizontal: 16,
              marginTop: 10,
            },
          ]}
        >
          <View style={styles.activeTop}>
            <View
              style={[
                styles.activePill,
                { backgroundColor: TYPE_COLORS[activeStoppage.type] },
              ]}
            >
              <Text style={styles.activePillText}>
                ● {activeStoppage.type.toUpperCase()} IN PROGRESS
              </Text>
            </View>
            <Text
              style={[styles.activeDuration, { color: TYPE_COLORS[activeStoppage.type] }]}
            >
              {fmtDuration((Date.now() - activeStoppage.startedAt) / 1000)}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              endActiveStoppage();
            }}
            style={({ pressed }) => [
              styles.endBtn,
              { opacity: pressed ? 0.7 : 1, borderColor: TYPE_COLORS[activeStoppage.type] },
            ]}
          >
            <Feather name="check-circle" size={18} color={TYPE_COLORS[activeStoppage.type]} />
            <Text
              style={[styles.endBtnText, { color: TYPE_COLORS[activeStoppage.type] }]}
            >
              End Stoppage
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={sorted}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <StoppageRow stoppage={item} tick={tick} />}
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: activeStoppage ? 12 : 12,
            paddingBottom: 90 + webBottom + insets.bottom,
          },
        ]}
        scrollEnabled={!!sorted.length}
        ListHeaderComponent={
          sorted.length > 0 && totalDowntimeSec > 0 ? (
            <View style={[styles.summary, { borderColor: colors.border }]}>
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
                Total Downtime
              </Text>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>
                {fmtDuration(totalDowntimeSec)}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="clock" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No stoppages yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Log stoppages from the Run tab or below
            </Text>
          </View>
        }
      />

      {/* FAB */}
      {!activeStoppage ? (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowModal(true);
          }}
          style={({ pressed }) => [
            styles.fab,
            {
              backgroundColor: colors.warning,
              bottom: 16 + webBottom + insets.bottom,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather name="pause-circle" size={22} color="#000" />
          <Text style={styles.fabText}>Log Stoppage</Text>
        </Pressable>
      ) : null}

      <AddStoppageModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onAdd={(type) => {
          addStoppage(type);
          setShowModal(false);
        }}
        onAddPast={(type, startedAt, endedAt, reason) => {
          addPastStoppage(type, startedAt, endedAt, reason);
          setShowModal(false);
        }}
      />
    </View>
  );
}

// Parse "HH:MM" (24h) into a today-anchored epoch ms, or null if invalid.
function parseTimeToMs(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

function AddStoppageModal({
  visible,
  onClose,
  onAdd,
  onAddPast,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (type: Stoppage["type"]) => void;
  onAddPast: (
    type: Stoppage["type"],
    startedAt: number,
    endedAt: number,
    reason?: string,
  ) => void;
}) {
  const colors = useColors();
  const [showPast, setShowPast] = useState(false);
  const [pastType, setPastType] = useState<Stoppage["type"]>("jam");
  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");
  const [reason, setReason] = useState("");

  const startMs = parseTimeToMs(startStr);
  const endMs = parseTimeToMs(endStr);
  const pastValid = startMs != null && endMs != null && endMs > startMs;

  const resetPast = () => {
    setShowPast(false);
    setPastType("jam");
    setStartStr("");
    setEndStr("");
    setReason("");
  };

  const handleClose = () => {
    resetPast();
    onClose();
  };

  const submitPast = () => {
    if (!pastValid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAddPast(pastType, startMs!, endMs!, reason.trim() || undefined);
    resetPast();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
            {showPast ? "Log Past Stoppage" : "Log Stoppage"}
          </Text>

          {!showPast ? (
            <>
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
                      {
                        backgroundColor: TYPE_COLORS[t.type],
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.typeBtnText}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowPast(true);
                }}
                style={({ pressed }) => [
                  styles.pastLink,
                  { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="clock" size={15} color={colors.mutedForeground} />
                <Text style={[styles.pastLinkText, { color: colors.foreground }]}>
                  Log a past stoppage
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.pastTypeRow}>
                {STOPPAGE_TYPES.map((t) => {
                  const active = pastType === t.type;
                  return (
                    <Pressable
                      key={t.type}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setPastType(t.type);
                      }}
                      style={[
                        styles.pastTypeChip,
                        {
                          backgroundColor: active ? TYPE_COLORS[t.type] : "transparent",
                          borderColor: active ? TYPE_COLORS[t.type] : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pastTypeChipText,
                          { color: active ? "#fff" : colors.mutedForeground },
                        ]}
                      >
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.pastTimeRow}>
                <View style={styles.pastTimeField}>
                  <Text style={[styles.pastLabel, { color: colors.mutedForeground }]}>
                    Start (HH:MM)
                  </Text>
                  <TextInput
                    value={startStr}
                    onChangeText={setStartStr}
                    placeholder="13:00"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numbers-and-punctuation"
                    style={[
                      styles.pastInput,
                      { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
                    ]}
                  />
                </View>
                <View style={styles.pastTimeField}>
                  <Text style={[styles.pastLabel, { color: colors.mutedForeground }]}>
                    End (HH:MM)
                  </Text>
                  <TextInput
                    value={endStr}
                    onChangeText={setEndStr}
                    placeholder="13:20"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numbers-and-punctuation"
                    style={[
                      styles.pastInput,
                      { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
                    ]}
                  />
                </View>
              </View>

              <Text style={[styles.pastLabel, { color: colors.mutedForeground, marginTop: 12 }]}>
                Reason (optional)
              </Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="What happened?"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.pastInput,
                  { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background, marginTop: 6 },
                ]}
              />

              {startStr.length > 0 && endStr.length > 0 && !pastValid ? (
                <Text style={[styles.pastError, { color: colors.destructive }]}>
                  End time must be a valid 24-hour time after the start time.
                </Text>
              ) : null}

              <View style={styles.pastActions}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowPast(false);
                  }}
                  style={({ pressed }) => [
                    styles.pastBack,
                    { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.pastBackText, { color: colors.mutedForeground }]}>
                    Back
                  </Text>
                </Pressable>
                <Pressable
                  disabled={!pastValid}
                  onPress={submitPast}
                  style={({ pressed }) => [
                    styles.pastSave,
                    {
                      backgroundColor: pastValid ? colors.primary : colors.secondary,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pastSaveText,
                      { color: pastValid ? "#000" : colors.mutedForeground },
                    ]}
                  >
                    Add Stoppage
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  runChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  runChipText: { fontSize: 13, fontWeight: "500" as const },
  runDot: { width: 6, height: 6, borderRadius: 3 },

  list: { paddingHorizontal: 16, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    overflow: "hidden",
    gap: 12,
  },
  typeTag: {
    width: 72,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
  },
  typeTagText: {
    color: "#fff",
    fontWeight: "700" as const,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  rowMid: { flex: 1, paddingVertical: 14 },
  rowTime: { fontSize: 14, fontWeight: "500" as const },
  rowReason: { fontSize: 12, marginTop: 2 },
  rowRight: { alignItems: "flex-end", paddingRight: 14, gap: 4 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  duration: { fontSize: 14, fontWeight: "600" as const },

  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
    marginBottom: 12,
  },
  summaryText: { fontSize: 13, fontWeight: "500" as const, letterSpacing: 0.3 },
  summaryValue: { fontSize: 15, fontWeight: "700" as const },

  activeCard: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    gap: 12,
  },
  activeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  activePill: { borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12 },
  activePillText: { color: "#fff", fontWeight: "700" as const, fontSize: 12 },
  activeDuration: { fontSize: 20, fontWeight: "700" as const },
  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    justifyContent: "center",
  },
  endBtnText: { fontWeight: "600" as const, fontSize: 15 },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: "600" as const },
  emptyText: { fontSize: 14, textAlign: "center" },

  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: "#000", fontWeight: "700" as const, fontSize: 15 },

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
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
  typeBtn: {
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 20,
    minWidth: "45%",
    alignItems: "center",
  },
  typeBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 16 },

  pastLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
  },
  pastLinkText: { fontSize: 14, fontWeight: "600" as const },

  pastTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  pastTypeChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  pastTypeChipText: { fontSize: 13, fontWeight: "700" as const },

  pastTimeRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  pastTimeField: { flex: 1 },
  pastLabel: { fontSize: 12, fontWeight: "500" as const, marginBottom: 6 },
  pastInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  pastError: { fontSize: 12, marginTop: 10 },

  pastActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  pastBack: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 22,
    alignItems: "center",
  },
  pastBackText: { fontSize: 15, fontWeight: "600" as const },
  pastSave: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  pastSaveText: { fontSize: 15, fontWeight: "700" as const },
});
