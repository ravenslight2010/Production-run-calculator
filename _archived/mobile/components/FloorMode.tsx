import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import {
  sauceBarrelBreakdown,
  type RunCalc,
  type RunState,
  type Stoppage,
} from "@/context/RunContext";

// Floor Mode is the mobile parity port of the web "Floor Mode" idle display:
// a full-screen, big-numbers monitor for the line. Two monitor-hygiene touches
// keep a tablet left on all shift safe: a slow content drift (burn-in) and an
// auto-dim after a stretch with no touches (restored instantly on interaction).

function fmtClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

// Manual thousands separators — Hermes lacks full Intl for toLocaleString.
function fmtComma(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

type StatusKey = "running" | "paused" | "stopped";

const STATUS_COLORS: Record<
  StatusKey,
  { bg: string; accent: string; bar: string; badge: string; badgeText: string }
> = {
  running: { bg: "#071a0f", accent: "#4ade80", bar: "#22c55e", badge: "#14532d", badgeText: "#bbf7d0" },
  paused: { bg: "#1a1100", accent: "#fbbf24", bar: "#f59e0b", badge: "#713f12", badgeText: "#fef3c7" },
  stopped: { bg: "#1a0707", accent: "#f87171", bar: "#ef4444", badge: "#7f1d1d", badgeText: "#fee2e2" },
};

interface FloorModeProps {
  visible: boolean;
  onClose: () => void;
  run: RunState;
  labelText: string;
  calc: RunCalc;
  supply: { doughShortCases: number; buffer: number };
  activeStoppage: Stoppage | null;
  allergenWarningCount: number;
  onLogStop: () => void;
  onEndStop: () => void;
  onSkidDone: () => void;
}

export default function FloorMode({
  visible,
  onClose,
  run,
  labelText,
  calc,
  supply,
  activeStoppage,
  allergenWarningCount,
  onLogStop,
  onEndStop,
  onSkidDone,
}: FloorModeProps) {
  const insets = useSafeAreaInsets();
  const drift = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(1)).current;
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Burn-in prevention: a very slow, small drift of the whole panel.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 45000, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 45000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, drift]);

  // Auto-dim after inactivity; restore instantly when armed by a touch.
  const armDim = useCallback(() => {
    dim.stopAnimation();
    Animated.timing(dim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    if (dimTimer.current) clearTimeout(dimTimer.current);
    dimTimer.current = setTimeout(() => {
      Animated.timing(dim, { toValue: 0.45, duration: 1200, useNativeDriver: true }).start();
    }, 90000);
  }, [dim]);

  useEffect(() => {
    if (!visible) {
      if (dimTimer.current) clearTimeout(dimTimer.current);
      return;
    }
    armDim();
    return () => {
      if (dimTimer.current) clearTimeout(dimTimer.current);
    };
  }, [visible, armDim]);

  if (!visible) return null;

  const s = run.settings;
  const p = run.progress;
  const ended = run.endedAt != null;
  const hasActiveStop = activeStoppage != null;
  const effectiveStatus: StatusKey = hasActiveStop
    ? "stopped"
    : run.isRunning
      ? "running"
      : "paused";
  const C = STATUS_COLORS[effectiveStatus];
  const statusLabel = hasActiveStop
    ? "STOPPAGE"
    : run.isRunning
      ? "RUNNING"
      : ended
        ? "ENDED"
        : "NOT STARTED";

  const casesCompleted = p.skidsCompleted * s.casesPerSkid + p.casesOnCurrentSkid;
  const totalSkids =
    s.casesNeeded > 0 && s.casesPerSkid > 0
      ? Math.ceil(s.casesNeeded / s.casesPerSkid)
      : 0;
  const pct = s.casesNeeded > 0 ? Math.min(1, casesCompleted / s.casesNeeded) : 0;

  // Pace: expected cases by now vs actual — mirrors web's formula. Mobile's
  // netElapsedSec already subtracts all downtime, so it stands in for web's
  // pause-aware elapsed time (mobile has no separate "pause" type).
  let paceStatus: "on-pace" | "ahead" | "behind" | null = null;
  let paceDelta = 0;
  if (run.startedAt && !run.endedAt && calc.ppm > 0 && s.pizzasPerCase > 0) {
    const elapsedMin = calc.netElapsedSec / 60;
    const elapsedAfterTunnel = Math.max(0, elapsedMin - s.freezerTime);
    const expectedCases = Math.floor((calc.ppm * elapsedAfterTunnel) / s.pizzasPerCase);
    paceDelta = casesCompleted - expectedCases;
    paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
  }

  const eta =
    calc.estCompletionMs != null && run.isRunning ? fmtClock(calc.estCompletionMs) : "—";

  type Chip = { key: string; label: string; bg: string; fg: string };
  const chips: Chip[] = [];
  if (paceStatus) {
    const map = {
      ahead: { label: `▲ ${Math.abs(paceDelta)} ahead`, bg: "rgba(22,101,52,0.5)", fg: "#bbf7d0" },
      behind: { label: `▼ ${Math.abs(paceDelta)} behind`, bg: "rgba(127,29,29,0.5)", fg: "#fecaca" },
      "on-pace": { label: "✓ On pace", bg: "rgba(255,255,255,0.08)", fg: "rgba(255,255,255,0.85)" },
    } as const;
    const m = map[paceStatus];
    chips.push({ key: "pace", label: m.label, bg: m.bg, fg: m.fg });
  }
  if (eta !== "—") {
    chips.push({ key: "eta", label: `ETA ${eta}`, bg: "rgba(255,255,255,0.08)", fg: "rgba(255,255,255,0.85)" });
  }
  if (supply.doughShortCases > 0) {
    chips.push({
      key: "dough",
      label: `Dough short ${Math.ceil(supply.doughShortCases)} cases`,
      bg: "rgba(127,29,29,0.5)",
      fg: "#fecaca",
    });
  }
  if (allergenWarningCount > 0) {
    chips.push({
      key: "allergen",
      label: `⚠ Allergen ×${allergenWarningCount}`,
      bg: "rgba(113,63,18,0.6)",
      fg: "#fde68a",
    });
  }

  // Frontline reference (sauce + applicators), matching the web overlay.
  type FLItem = { label: string; oz: number; value: string };
  const fl: FLItem[] = [];
  if (s.frontlineRecipeName.trim() && s.sauceOzPerPizza > 0) {
    const bd =
      calc.sauceBatches > 0 ? sauceBarrelBreakdown(calc.sauceLbs, calc.sauceEffBarrel) : null;
    const valStr =
      calc.sauceBatches > 0
        ? bd
          ? `${calc.sauceBatches.toFixed(1)}bt · ${bd.totalBarrels}bbl`
          : `${calc.sauceBatches.toFixed(1)} batches`
        : "";
    fl.push({ label: s.frontlineRecipeName, oz: s.sauceOzPerPizza, value: valStr });
  }
  const apps = [
    { type: s.app1Type, oz: s.app1OzPerPizza, lbs: calc.app1Lbs, batches: calc.app1Batches },
    { type: s.app2Type, oz: s.app2OzPerPizza, lbs: calc.app2Lbs, batches: calc.app2Batches },
    { type: s.app3Type, oz: s.app3OzPerPizza, lbs: calc.app3Lbs, batches: calc.app3Batches },
    { type: s.app4Type, oz: s.app4OzPerPizza, lbs: calc.app4Lbs, batches: calc.app4Batches },
  ];
  for (const a of apps) {
    if (!a.type.trim() || a.oz <= 0) continue;
    const isMix = a.type.trim().toLowerCase().includes("mix");
    const valStr = isMix
      ? a.lbs > 0
        ? `${a.lbs.toFixed(1)} lbs`
        : ""
      : a.batches > 0
        ? `${a.batches.toFixed(1)} batches`
        : "";
    fl.push({ label: a.type, oz: a.oz, value: valStr });
  }

  const driftX = drift.interpolate({ inputRange: [0, 1], outputRange: [-7, 7] });
  const driftY = drift.interpolate({ inputRange: [0, 1], outputRange: [6, -6] });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View
        style={[styles.root, { backgroundColor: C.bg, opacity: dim }]}
        onStartShouldSetResponderCapture={() => {
          armDim();
          return false;
        }}
      >
        <Animated.View
          style={[
            styles.drift,
            {
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX: driftX }, { translateY: driftY }],
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ gap: 8 }}>
              <Text style={styles.runLabel} numberOfLines={1}>
                {labelText || "No Active Run"}
              </Text>
              <View style={[styles.badge, { backgroundColor: C.badge }]}>
                <View style={[styles.dot, { backgroundColor: C.accent }]} />
                <Text style={[styles.badgeText, { color: C.badgeText }]}>{statusLabel}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <Feather name="x" size={22} color="rgba(255,255,255,0.55)" />
            </Pressable>
          </View>

          {/* Big numbers */}
          <View style={styles.main}>
            <View style={styles.numBlock}>
              <Text style={styles.bigNum}>{fmtComma(casesCompleted)}</Text>
              <Text style={[styles.numLabel, { color: C.accent }]}>CASES DONE</Text>
            </View>
            <View style={styles.numBlock}>
              <Text style={[styles.bigNum, styles.bigNumMid, { color: "rgba(255,255,255,0.85)" }]}>
                {p.skidsCompleted}
                {totalSkids > 0 ? ` / ${totalSkids}` : ""}
              </Text>
              <Text style={[styles.numLabel, { color: C.accent }]}>SKIDS</Text>
            </View>
            {p.subTab !== "crusts" && (
              <View style={styles.numBlock}>
                <Text style={[styles.bigNum, { color: C.accent }]}>{p.batchesReady}</Text>
                <Text style={[styles.numLabel, { color: C.accent }]}>BATCHES READY</Text>
              </View>
            )}
          </View>

          {/* Bottom */}
          <View style={styles.bottom}>
            {chips.length > 0 && (
              <View style={styles.chipRow}>
                {chips.map((c) => (
                  <View key={c.key} style={[styles.chip, { backgroundColor: c.bg }]}>
                    <Text style={[styles.chipText, { color: c.fg }]}>{c.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Progress */}
            <View style={{ gap: 6 }}>
              <View style={styles.progRow}>
                <Text style={styles.progLabel}>RUN PROGRESS</Text>
                <Text style={styles.progLabel}>{Math.round(pct * 100)}%</Text>
              </View>
              <View style={styles.progTrack}>
                <View
                  style={[styles.progFill, { width: `${pct * 100}%`, backgroundColor: C.bar }]}
                />
              </View>
            </View>

            {/* Frontline reference */}
            {fl.length > 0 && (
              <View style={styles.frontline}>
                <Text style={styles.flHeading}>FRONTLINE</Text>
                <View style={styles.flGrid}>
                  {fl.map((item, i) => (
                    <View key={i} style={styles.flItem}>
                      <Text style={styles.flLabel} numberOfLines={1}>
                        {item.label}
                      </Text>
                      <Text style={styles.flOz}>{item.oz} oz</Text>
                      {item.value ? <Text style={styles.flValue}>{item.value}</Text> : null}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.actions}>
              {hasActiveStop ? (
                <Pressable
                  onPress={onEndStop}
                  style={({ pressed }) => [
                    styles.actBtn,
                    {
                      flex: 1,
                      backgroundColor: "rgba(234,88,12,0.5)",
                      borderColor: "rgba(234,88,12,0.4)",
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Feather name="play-circle" size={18} color="#fed7aa" />
                  <Text style={[styles.actText, { color: "#fed7aa" }]}>End Stop</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={onLogStop}
                  style={({ pressed }) => [
                    styles.actBtn,
                    {
                      flex: 1,
                      backgroundColor: "rgba(127,29,29,0.45)",
                      borderColor: "rgba(239,68,68,0.2)",
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Feather name="pause-circle" size={18} color="#fca5a5" />
                  <Text style={[styles.actText, { color: "#fca5a5" }]}>Log Stop</Text>
                </Pressable>
              )}
              {run.isRunning && !hasActiveStop && (
                <Pressable
                  onPress={onSkidDone}
                  style={({ pressed }) => [
                    styles.actBtn,
                    { flex: 1.3, backgroundColor: C.bar, borderColor: C.bar, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Feather name="check" size={18} color={C.bg} />
                  <Text style={[styles.actText, { color: C.bg }]}>Skid Done</Text>
                </Pressable>
              )}
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  drift: { flex: 1, paddingHorizontal: 18 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  runLabel: { fontFamily: FONTS.bold, fontSize: 18, color: "rgba(255,255,255,0.75)" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  dot: { width: 7, height: 7, borderRadius: 999 },
  badgeText: { fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 2 },
  closeBtn: {
    padding: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  main: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
  },
  numBlock: { alignItems: "center" },
  bigNum: {
    fontFamily: FONTS.monoBold,
    fontSize: 84,
    lineHeight: 88,
    color: "#fff",
  },
  bigNumMid: { fontSize: 64, lineHeight: 68 },
  numLabel: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    letterSpacing: 3,
    marginTop: 4,
    opacity: 0.8,
  },
  bottom: { gap: 14 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipText: { fontFamily: FONTS.bold, fontSize: 13 },
  progRow: { flexDirection: "row", justifyContent: "space-between" },
  progLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
    letterSpacing: 1,
  },
  progTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  progFill: { height: 6, borderRadius: 999 },
  frontline: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  flHeading: {
    fontFamily: FONTS.bold,
    fontSize: 9,
    letterSpacing: 2,
    color: "rgba(255,255,255,0.25)",
    marginBottom: 8,
  },
  flGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  flItem: { gap: 2, minWidth: 70, flexShrink: 1 },
  flLabel: { fontFamily: FONTS.semibold, fontSize: 10, color: "rgba(255,255,255,0.45)" },
  flOz: { fontFamily: FONTS.bold, fontSize: 14, color: "rgba(255,255,255,0.85)" },
  flValue: { fontFamily: FONTS.mono, fontSize: 10, color: "rgba(255,255,255,0.3)" },
  actions: { flexDirection: "row", gap: 12 },
  actBtn: {
    height: 64,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actText: { fontFamily: FONTS.bold, fontSize: 16 },
});
