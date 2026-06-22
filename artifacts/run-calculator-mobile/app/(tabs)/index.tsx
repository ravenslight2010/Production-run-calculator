import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  MetricCard,
  NumericField,
  SectionHeader,
  SelectField,
  StatRow,
} from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import {
  allergenMeta,
  normalizeAllergen,
  allergenSequenceWarnings,
  type AllergenSequenceItem,
} from "@workspace/allergen";
import {
  evaluateRules,
  type RuleSequenceItem,
} from "@workspace/production-rules";
import { useProductionRules } from "@/hooks/useProductionRules";
import {
  useRun,
  useRunClock,
  runLabel,
  profileKey,
  computeDoughSupply,
  type DoughSupplyMode,
  type Stoppage,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { useNotifications } from "@/hooks/useNotifications";
import FloorMode from "@/components/FloorMode";

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

function n2s(n: number): string {
  return n > 0 ? n.toString() : "";
}

function toNum(s: string | undefined | null): number {
  if (s == null || s === "") return 0;
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? 0 : n;
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
    run,
    runIndex, runCount, allRuns,
    startRun, endRun,
    updateProgress, addStoppage, endActiveStoppage,
    addRun, switchRun, deleteRun,
    runToTime, setRunToTime,
    applyCarryOver,
    syncStatus,
    updateSettings, saveProfile, applyProfile, hasProfile,
    brands, brandFlavors, addListItem, removeListItem, addFlavor, removeFlavor,
  } = useRun();
  const { calc, activeStoppage } = useRunClock();
  const [showModal, setShowModal] = useState(false);
  const [showRunPicker, setShowRunPicker] = useState(false);
  // Per-run acknowledgement of strict-rule checklists. Keyed by
  // `${runId}#${ruleId}#${stepIndex}` so checks reset per run yet stay satisfied
  // when returning to a run (web parity). A strict violation with a checklist
  // blocks Start until every step is checked; one without a checklist blocks
  // outright.
  const [checklistAcks, setChecklistAcks] = useState<Record<string, boolean>>({});
  const doughSubTab: DoughSupplyMode = run.progress.subTab;

  // ── Current-run identity (brand / flavor / cases) — edited inline here, like web ──
  const [idForm, setIdForm] = useState({
    brand: run.settings.brand,
    flavor: run.settings.flavor,
    casesNeeded: n2s(run.settings.casesNeeded),
  });
  const lastProfileKey = useRef<string | null>(
    profileKey(run.settings.brand, run.settings.flavor),
  );

  // Don't auto-apply a profile just because we switched runs.
  useEffect(() => {
    lastProfileKey.current = profileKey(run.settings.brand, run.settings.flavor);
  }, [run.id]);

  // Keep the identity form in sync when settings change externally
  // (profile auto-load, run switch). Typing only commits on blur, so this
  // won't clobber in-progress edits.
  useEffect(() => {
    setIdForm({
      brand: run.settings.brand,
      flavor: run.settings.flavor,
      casesNeeded: n2s(run.settings.casesNeeded),
    });
  }, [run.settings.brand, run.settings.flavor, run.settings.casesNeeded]);

  // Auto-load a saved brand/flavor profile when the combo changes to one we have.
  useEffect(() => {
    const b = run.settings.brand.trim();
    const f = run.settings.flavor.trim();
    const key = profileKey(b, f);
    if (key === lastProfileKey.current) return;
    lastProfileKey.current = key;
    if (b && f && hasProfile(b, f)) applyProfile(b, f);
  }, [run.settings.brand, run.settings.flavor, hasProfile, applyProfile]);

  const commitId = () => {
    updateSettings({
      brand: idForm.brand.trim(),
      flavor: idForm.flavor.trim(),
      casesNeeded: toNum(idForm.casesNeeded),
    });
  };

  // Brand/flavor are picked from saved lists (like web) via a searchable
  // dropdown; new entries are typed into the picker's search and added.
  const selectBrand = (b: string) => {
    Haptics.selectionAsync();
    setIdForm((f) => ({ ...f, brand: b }));
    updateSettings({ brand: b });
  };
  const selectFlavor = (fl: string) => {
    Haptics.selectionAsync();
    setIdForm((f) => ({ ...f, flavor: fl }));
    updateSettings({ flavor: fl });
  };
  const addBrand = (v: string) => {
    if (!brands.includes(v)) addListItem("brands", v);
  };
  const addFlavorOpt = (v: string) => {
    const b = idForm.brand.trim();
    if (b && !(brandFlavors[b] ?? []).includes(v)) addFlavor(b, v);
  };

  const nowMs = Date.now();
  const supply = computeDoughSupply(run, nowMs, doughSubTab);

  // ── Floor Mode (idle big-numbers display; mobile parity with web) ──────────
  // Auto-activates after 3 min of no touches on the run screen and can be
  // opened manually. Touches anywhere on the screen re-arm the idle timer.
  const [showFloorMode, setShowFloorMode] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setShowFloorMode(true), 3 * 60 * 1000);
  }, []);
  // Only arm the idle timer while the Run tab is focused — otherwise the
  // background tab could pop Floor Mode over whatever screen the user is on
  // (tabs stay mounted in expo-router).
  useFocusEffect(
    useCallback(() => {
      if (!showFloorMode) resetIdle();
      return () => {
        if (idleTimer.current) clearTimeout(idleTimer.current);
      };
    }, [showFloorMode, resetIdle]),
  );

  // Allergen sequence warnings across today's lineup (matches web's overlay).
  const floorAllergenWarnings = useMemo(() => {
    const seq: AllergenSequenceItem[] = allRuns.map((r, i) => ({
      id: r.id,
      label: `Run ${i + 1} · ${runLabel(r, i)}`,
      allergen: normalizeAllergen(r.settings.allergen),
    }));
    return allergenSequenceWarnings(seq);
  }, [allRuns]);

  // Smart carry-over of leftover dough/crusts into the next run.
  const hasNextRun = runIndex < runCount - 1;
  const carryOver = (() => {
    if (run.progress.carryOverDone) return null;
    const excessPizzas = supply.buffer * run.settings.pizzasPerCase;
    if (excessPizzas < 1 || supply.perTray <= 0) return null;
    const excessBatches =
      supply.perBatch > 0 ? Math.floor(excessPizzas / supply.perBatch) : 0;
    const afterBatches =
      excessBatches > 0 ? excessPizzas - excessBatches * supply.perBatch : excessPizzas;
    const excessTrays = Math.floor(afterBatches / supply.perTray);
    if (excessTrays === 0 && excessBatches === 0) return null;
    return { excessTrays, excessBatches };
  })();

  const { showBatchDue, setShowBatchDue } = useNotifications({
    run,
    runIndex,
    calc,
    nowMs: Date.now(),
  });

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const label = runLabel(run, runIndex);
  const currentAllergenMeta = allergenMeta(normalizeAllergen(run.settings.allergen));

  // Manager-defined production rules (factory-wide). "strict" violations block
  // starting the run; the Configure tab shows the full warning text.
  const { rules: productionRules } = useProductionRules();
  const ruleViolations = useMemo(() => {
    const s = run.settings;
    const effectiveLineSpeed =
      s.crustsPerCycle > 0
        ? s.crustsPerCycle * s.cycleSpeed * (s.speedAdjustment || 1)
        : s.lineSpeedPPM;
    const fields = {
      brand: s.brand,
      flavor: s.flavor,
      casesNeeded: s.casesNeeded,
      lineSpeed: effectiveLineSpeed,
      targetDoughballWeight: s.doughballWeightOz,
      sauceOzPerPizza: s.sauceOzPerPizza,
      dieType: s.dieType,
    };
    const seq: RuleSequenceItem[] = allRuns.map((r, i) => ({
      id: r.id,
      label: `Run ${i + 1} · ${runLabel(r, i)}`,
      attributes: { allergen: normalizeAllergen(r.settings.allergen) },
    }));
    return evaluateRules(productionRules, {
      fields,
      runLabel: runLabel(run, runIndex),
      sequence: seq,
      currentRunId: run.id,
    });
  }, [productionRules, allRuns, run, runIndex]);
  const strictViolations = ruleViolations.filter((x) => x.enforcement === "strict");
  const ackKey = (ruleId: string, i: number) => `${run.id}#${ruleId}#${i}`;
  const toggleAck = (ruleId: string, i: number) =>
    setChecklistAcks((prev) => {
      const k = ackKey(ruleId, i);
      return { ...prev, [k]: !prev[k] };
    });
  const checklistSatisfied = (rv: { ruleId: string; checklist?: string[] }) => {
    const cl = rv.checklist ?? [];
    if (cl.length === 0) return false;
    return cl.every((_, i) => checklistAcks[ackKey(rv.ruleId, i)]);
  };
  const blockingViolations = strictViolations.filter((rv) => !checklistSatisfied(rv));
  const checklistViolations = strictViolations.filter(
    (rv) => (rv.checklist ?? []).length > 0,
  );

  // Other runs in today's lineup that haven't been finished yet.
  const upcomingRuns = allRuns
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i !== runIndex && r.endedAt == null);

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
      onStartShouldSetResponderCapture={() => {
        if (!showFloorMode) resetIdle();
        return false;
      }}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop, paddingBottom: 166 + webBottom + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setShowFloorMode(true);
          }}
          style={({ pressed }) => [
            styles.floorLaunch,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="maximize" size={14} color={colors.mutedForeground} />
          <Text style={[styles.floorLaunchText, { color: colors.mutedForeground }]}>
            Floor Mode
          </Text>
        </Pressable>

        {/* Current run identity — brand / flavor / cases, edited inline (matches web) */}
        <Card title="Current Run" icon="package" style={styles.topCard}>
          <Text style={[styles.idLabel, { color: colors.mutedForeground }]}>Brand</Text>
          <SelectField
            value={idForm.brand}
            onChange={selectBrand}
            options={brands}
            onAddOption={addBrand}
            onRemoveOption={(v) => removeListItem("brands", v)}
            placeholder="Select or add a brand…"
          />

          <Text style={[styles.idLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Flavor</Text>
          {idForm.brand.trim() ? (
            <SelectField
              value={idForm.flavor}
              onChange={selectFlavor}
              options={brandFlavors[idForm.brand.trim()] ?? []}
              onAddOption={addFlavorOpt}
              onRemoveOption={(v) => removeFlavor(idForm.brand.trim(), v)}
              placeholder="Select or add a flavor…"
            />
          ) : (
            <Text style={[styles.idEmpty, { color: colors.mutedForeground }]}>Pick a brand first.</Text>
          )}
          <NumericField
            label="Cases Needed"
            value={idForm.casesNeeded}
            onChangeText={(t) => setIdForm((f) => ({ ...f, casesNeeded: t }))}
            onBlur={commitId}
            placeholder="0"
          />
          {toNum(idForm.casesNeeded) <= 0 ? (
            <Text style={[styles.casesWarn, { color: colors.warning }]}>
              ⚠ Enter cases needed to enable calculations
            </Text>
          ) : null}
          <Pressable
            onPress={() => {
              if (!idForm.brand.trim() || !idForm.flavor.trim()) return;
              // Commit any typed-but-unblurred identity first; the queued
              // setAppState updater runs before saveProfile's, so the profile
              // is keyed/saved off the latest brand+flavor.
              commitId();
              saveProfile();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
            disabled={!idForm.brand.trim() || !idForm.flavor.trim()}
            style={({ pressed }) => [
              styles.profileBtn,
              {
                backgroundColor: colors.secondary,
                borderColor: colors.border,
                opacity:
                  !idForm.brand.trim() || !idForm.flavor.trim()
                    ? 0.4
                    : pressed
                      ? 0.6
                      : 1,
              },
            ]}
          >
            <Feather name="save" size={15} color={colors.foreground} />
            <Text style={[styles.profileBtnText, { color: colors.foreground }]}>
              {idForm.brand.trim() &&
              idForm.flavor.trim() &&
              hasProfile(idForm.brand, idForm.flavor)
                ? "Update Profile for Brand + Flavor"
                : "Save Profile for Brand + Flavor"}
            </Text>
          </Pressable>
          <Text style={[styles.profileHint, { color: colors.mutedForeground }]}>
            Saved settings auto-load next time you enter this brand + flavor.
          </Text>
        </Card>

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
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Text style={[styles.navLabel, { color: colors.foreground }]} numberOfLines={1}>
                {label}
              </Text>
              {currentAllergenMeta.isAllergen ? (
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: currentAllergenMeta.color }}>
                  <Text style={{ fontSize: 10, fontFamily: FONTS.bold, color: currentAllergenMeta.textColor, textTransform: "uppercase" }}>
                    {currentAllergenMeta.label}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.navSubRow}>
              <View
                style={[
                  styles.syncDot,
                  {
                    backgroundColor:
                      syncStatus === "online"
                        ? colors.success
                        : syncStatus === "connecting"
                          ? "#ff9f0a"
                          : colors.mutedForeground,
                  },
                ]}
              />
              <Text style={[styles.navSub, { color: colors.mutedForeground }]}>
                Run {runIndex + 1} of {runCount}
                {syncStatus === "online"
                  ? " · Synced"
                  : syncStatus === "connecting"
                    ? " · Connecting…"
                    : " · Offline"}
              </Text>
            </View>
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

        {/* Batch-due banner — dough runs only */}
        {showBatchDue && doughSubTab !== "crusts" ? (
          <Pressable
            onPress={() => setShowBatchDue(false)}
            style={[styles.batchDueBanner, { backgroundColor: colors.primary }]}
          >
            <Feather name="bell" size={16} color={colors.primaryForeground} />
            <Text style={[styles.batchDueText, { color: colors.primaryForeground }]}>
              Start next dough batch now
            </Text>
            <Feather name="x" size={16} color={colors.primaryForeground} />
          </Pressable>
        ) : null}

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

        {/* Smart carry-over prompt */}
        {carryOver && hasNextRun ? (
          <View style={[styles.carryCard, { backgroundColor: colors.card, borderColor: colors.success }]}>
            <View style={styles.carryHeader}>
              <Feather name="corner-down-right" size={16} color={colors.success} />
              <Text style={[styles.carryTitle, { color: colors.success }]}>
                Carry over leftover {doughSubTab === "crusts" ? "crusts" : "dough"}?
              </Text>
            </View>
            <Text style={[styles.carryBody, { color: colors.foreground }]}>
              {carryOver.excessTrays > 0 ? (
                <Text style={styles.carryStrong}>
                  {carryOver.excessTrays}{" "}
                  {doughSubTab === "crusts"
                    ? `stack${carryOver.excessTrays !== 1 ? "s" : ""}`
                    : `tray${carryOver.excessTrays !== 1 ? "s" : ""}`}
                </Text>
              ) : null}
              {carryOver.excessTrays > 0 && carryOver.excessBatches > 0 && doughSubTab !== "crusts"
                ? " + "
                : ""}
              {carryOver.excessBatches > 0 && doughSubTab !== "crusts" ? (
                <Text style={styles.carryStrong}>
                  {carryOver.excessBatches} batch{carryOver.excessBatches !== 1 ? "es" : ""}
                </Text>
              ) : null}
              {" left over — add to the next run."}
            </Text>
            <View style={styles.carryActions}>
              <Pressable
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  applyCarryOver(carryOver.excessTrays, carryOver.excessBatches);
                }}
                style={({ pressed }) => [
                  styles.carryAccept,
                  { backgroundColor: colors.success, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={styles.carryAcceptText}>Carry Over</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  updateProgress({ carryOverDone: true });
                }}
                style={({ pressed }) => [
                  styles.carryDismiss,
                  { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.carryDismissText, { color: colors.mutedForeground }]}>
                  Dismiss
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Case completion progress */}
        {(() => {
          const casesNeeded = run.settings.casesNeeded;
          const casesCompleted =
            run.progress.skidsCompleted * run.settings.casesPerSkid +
            run.progress.casesOnCurrentSkid;
          if (casesNeeded <= 0 || casesCompleted <= 0) return null;
          if (casesCompleted >= casesNeeded) {
            return (
              <View
                style={[
                  styles.targetBanner,
                  { backgroundColor: colors.success + "22", borderColor: colors.success },
                ]}
              >
                <Feather name="check-circle" size={16} color={colors.success} />
                <Text style={[styles.targetBannerText, { color: colors.success }]}>
                  Target reached! {casesCompleted} / {casesNeeded} cases
                </Text>
              </View>
            );
          }
          const pct = Math.min(100, (casesCompleted / casesNeeded) * 100);
          return (
            <View style={styles.caseProgressWrap}>
              <View style={styles.caseProgressHeader}>
                <Text style={[styles.caseProgressLabel, { color: colors.mutedForeground }]}>
                  Cases completed
                </Text>
                <Text style={[styles.caseProgressValue, { color: colors.foreground }]}>
                  {casesCompleted} / {casesNeeded}{" "}
                  <Text style={{ color: colors.mutedForeground }}>({Math.round(pct)}%)</Text>
                </Text>
              </View>
              <View style={[styles.caseProgressTrack, { backgroundColor: colors.secondary }]}>
                <View
                  style={[
                    styles.caseProgressFill,
                    { backgroundColor: colors.primary, width: `${pct}%` },
                  ]}
                />
              </View>
            </View>
          );
        })()}

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

        {/* Run Details (moved from Dough tab) — sub-view aware */}
        <Card title="Run Details" icon="clipboard" style={styles.sectionCard}>
          <StatRow
            label="Cases Left to Run"
            value={supply.casesLeftToRun.toString()}
            highlight={supply.casesLeftToRun > 0}
          />
          <StatRow
            label={doughSubTab === "crusts" ? "Cases to Open" : "Approx. Cases on Line"}
            value={(doughSubTab === "crusts"
              ? supply.casesLeftToOpen
              : supply.casesOnLine
            ).toString()}
          />
          <View style={styles.runDetailStatusRow}>
            <Text style={[styles.runDetailStatusLabel, { color: colors.mutedForeground }]}>
              {doughSubTab === "crusts" ? "Crust Supply" : "Dough Status"}
            </Text>
            {(() => {
              const shortInt = Math.ceil(supply.doughShortCases);
              const bufferInt = Math.floor(supply.buffer);
              if (shortInt > 0) {
                return (
                  <View style={styles.runDetailStatus}>
                    <View style={[styles.statusDot, { backgroundColor: "#f87171" }]} />
                    <Text style={[styles.runDetailStatusText, { color: "#f87171" }]}>
                      SHORT {shortInt} case{shortInt !== 1 ? "s" : ""}
                    </Text>
                  </View>
                );
              }
              if (bufferInt > 0) {
                return (
                  <View style={styles.runDetailStatus}>
                    <View style={[styles.statusDot, { backgroundColor: "#4ade80" }]} />
                    <Text style={[styles.runDetailStatusText, { color: "#4ade80" }]}>
                      +{bufferInt} case{bufferInt !== 1 ? "s" : ""} ahead
                    </Text>
                  </View>
                );
              }
              return (
                <View style={styles.runDetailStatus}>
                  <View style={[styles.statusDot, { backgroundColor: colors.mutedForeground }]} />
                  <Text style={[styles.runDetailStatusText, { color: colors.mutedForeground }]}>
                    Balanced
                  </Text>
                </View>
              );
            })()}
          </View>
        </Card>

        {/* Run to Time */}
        {calc.pizzasLeft > 0 ? (
          <Card title="Run to Time" icon="clock" style={styles.sectionCard}>
              <View style={styles.runToTimeRow}>
                <Text style={[styles.runToTimeLabel, { color: colors.mutedForeground }]}>
                  Run until
                </Text>
                <TextInput
                  value={runToTime}
                  onChangeText={(t) => setRunToTime(t)}
                  placeholder="19:15"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={[
                    styles.runToTimeInput,
                    {
                      color: colors.foreground,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                />
                <Text style={[styles.runToTimeLabel, { color: colors.mutedForeground }]}>
                  24h
                </Text>
              </View>
              {(() => {
                const m = /^(\d{1,2}):(\d{2})$/.exec(runToTime.trim());
                if (!m) {
                  return (
                    <Text style={[styles.runToTimeHint, { color: colors.mutedForeground }]}>
                      Enter a target time as HH:MM (24-hour).
                    </Text>
                  );
                }
                const hrs = Number(m[1]);
                const mins = Number(m[2]);
                if (hrs > 23 || mins > 59) {
                  return (
                    <Text style={[styles.runToTimeHint, { color: colors.mutedForeground }]}>
                      Enter a valid 24-hour time (00:00–23:59).
                    </Text>
                  );
                }
                const now = new Date();
                const target = new Date(now);
                target.setHours(hrs, mins, 0, 0);
                if (target <= now) target.setDate(target.getDate() + 1);
                const minutesAvailable = Math.max(
                  0,
                  (target.getTime() - now.getTime()) / 60000,
                );
                const pizzasInWindow = calc.ppm > 0 ? calc.ppm * minutesAvailable : 0;
                const casesInWindow =
                  run.settings.pizzasPerCase > 0
                    ? Math.floor(pizzasInWindow / run.settings.pizzasPerCase)
                    : 0;
                const doughLbsInWindow =
                  run.settings.doughballWeightOz > 0
                    ? (pizzasInWindow * run.settings.doughballWeightOz) / 16
                    : 0;
                const batchesToMix =
                  calc.doughEffBatch > 0 ? doughLbsInWindow / calc.doughEffBatch : 0;
                const h = Math.floor(minutesAvailable / 60);
                const mm = Math.round(minutesAvailable % 60);
                return (
                  <View style={styles.runToTimeGrid}>
                    <View style={styles.runToTimeStat}>
                      <Text style={[styles.runToTimeValue, { color: colors.primary }]}>
                        {h > 0 ? `${h}h ` : ""}
                        {mm}m
                      </Text>
                      <Text style={[styles.runToTimeStatLabel, { color: colors.mutedForeground }]}>
                        Time available
                      </Text>
                    </View>
                    <View style={styles.runToTimeStat}>
                      <Text style={[styles.runToTimeValue, { color: colors.foreground }]}>
                        {casesInWindow}
                      </Text>
                      <Text style={[styles.runToTimeStatLabel, { color: colors.mutedForeground }]}>
                        Cases in window
                      </Text>
                    </View>
                    {batchesToMix > 0 ? (
                      <View style={styles.runToTimeStat}>
                        <Text style={[styles.runToTimeValue, { color: colors.foreground }]}>
                          {batchesToMix.toFixed(1)}
                        </Text>
                        <Text style={[styles.runToTimeStatLabel, { color: colors.mutedForeground }]}>
                          Dough batches
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })()}
          </Card>
        ) : null}

        {/* Upcoming runs */}
        {upcomingRuns.length > 0 ? (
          <Card
            title="Upcoming Runs"
            icon="list"
            style={styles.sectionCard}
            contentStyle={{ paddingVertical: 2 }}
          >
              {upcomingRuns.map(({ r, i }) => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    switchRun(i);
                  }}
                  style={({ pressed }) => [
                    styles.upcomingRow,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.upcomingLabel, { color: colors.foreground }]} numberOfLines={1}>
                      {runLabel(r, i)}
                    </Text>
                    <Text style={[styles.upcomingSub, { color: colors.mutedForeground }]}>
                      {r.settings.casesNeeded > 0 ? `${r.settings.casesNeeded} cases` : "Not configured"}
                      {r.isRunning ? "  ● Running" : ""}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              ))}
          </Card>
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

      {/* Persistent run-control bar — stays put while the page scrolls */}
      {(() => {
        const ended = run.endedAt != null;
        const casesNeeded = run.settings.casesNeeded;
        const casesCompleted =
          run.progress.skidsCompleted * run.settings.casesPerSkid +
          run.progress.casesOnCurrentSkid;
        const pct =
          casesNeeded > 0
            ? Math.min(100, (casesCompleted / casesNeeded) * 100)
            : 0;
        const tabBarH = Platform.OS === "web" ? 84 : 49 + insets.bottom;
        return (
          <View
            style={[
              styles.controlBar,
              {
                bottom: tabBarH,
                backgroundColor: colors.card,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={styles.controlKpi}>
              {casesNeeded > 0 ? (
                <>
                  <View style={styles.controlKpiTop}>
                    <Text
                      style={[styles.controlKpiValue, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {casesCompleted}
                      <Text style={{ color: colors.mutedForeground }}>
                        /{casesNeeded}
                      </Text>
                    </Text>
                    <Text style={[styles.controlKpiPct, { color: colors.primary }]}>
                      {Math.round(pct)}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.controlKpiTrack,
                      { backgroundColor: colors.secondary },
                    ]}
                  >
                    <View
                      style={[
                        styles.controlKpiFill,
                        { backgroundColor: colors.primary, width: `${pct}%` },
                      ]}
                    />
                  </View>
                  <Text
                    style={[styles.controlKpiSub, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {run.isRunning
                      ? `${fmtElapsed(calc.netElapsedSec)} net · ${
                          calc.ppm > 0 ? calc.ppm.toFixed(1) + " ppm" : "— ppm"
                        }`
                      : ended
                        ? "Run ended"
                        : "Cases completed"}
                  </Text>
                </>
              ) : (
                <Text
                  style={[styles.controlKpiSub, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  Enter cases needed to track progress
                </Text>
              )}
            </View>

            <View style={styles.controlActions}>
              {activeStoppage ? (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    endActiveStoppage();
                  }}
                  style={({ pressed }) => [
                    styles.ctrlBtn,
                    styles.ctrlBtnWide,
                    { backgroundColor: colors.warning, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <Feather name="play" size={16} color="#000" />
                  <Text style={[styles.ctrlBtnText, { color: "#000" }]}>
                    End {activeStoppage.type}
                  </Text>
                </Pressable>
              ) : run.isRunning ? (
                <>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowModal(true);
                    }}
                    style={({ pressed }) => [
                      styles.ctrlBtn,
                      {
                        borderWidth: 1,
                        borderColor: colors.warning,
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Feather name="pause-circle" size={16} color={colors.warning} />
                    <Text style={[styles.ctrlBtnText, { color: colors.warning }]}>
                      Stop
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      endRun();
                    }}
                    style={({ pressed }) => [
                      styles.ctrlBtn,
                      { backgroundColor: "#ef4444", opacity: pressed ? 0.75 : 1 },
                    ]}
                  >
                    <Feather name="square" size={14} color="#fff" />
                    <Text style={[styles.ctrlBtnText, { color: "#fff" }]}>End</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => {
                    if (blockingViolations.length > 0) {
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Error,
                      );
                      const anyChecklist = blockingViolations.some(
                        (x) => (x.checklist ?? []).length > 0,
                      );
                      Alert.alert(
                        "Can't start run",
                        `Blocked by production rule${blockingViolations.length > 1 ? "s" : ""}:\n\n` +
                          blockingViolations.map((x) => `• ${x.message}`).join("\n") +
                          (anyChecklist
                            ? "\n\nComplete the checklist below, fix these on the Configure tab, or ask a manager to adjust the rule."
                            : "\n\nFix these on the Configure tab, or ask a manager to adjust the rule."),
                      );
                      return;
                    }
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    startRun();
                  }}
                  style={({ pressed }) => [
                    styles.ctrlBtn,
                    styles.ctrlBtnWide,
                    {
                      backgroundColor:
                        blockingViolations.length > 0 ? colors.muted : colors.success,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Feather
                    name={blockingViolations.length > 0 ? "lock" : "play"}
                    size={16}
                    color={blockingViolations.length > 0 ? colors.mutedForeground : "#000"}
                  />
                  <Text
                    style={[
                      styles.ctrlBtnText,
                      {
                        color:
                          blockingViolations.length > 0 ? colors.mutedForeground : "#000",
                      },
                    ]}
                  >
                    Start Run
                  </Text>
                </Pressable>
              )}
            </View>

            {!run.isRunning && !activeStoppage && checklistViolations.length > 0 ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                {checklistViolations.map((rv) => {
                  const cl = rv.checklist ?? [];
                  const cleared = checklistSatisfied(rv);
                  return (
                    <View
                      key={rv.ruleId}
                      style={{
                        gap: 8,
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: cleared ? "#16a34a" : "#dc2626",
                        backgroundColor: cleared ? "#16a34a22" : "#dc262622",
                      }}
                    >
                      <View
                        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        <Feather
                          name={cleared ? "check-circle" : "alert-triangle"}
                          size={14}
                          color={cleared ? "#86efac" : "#fca5a5"}
                        />
                        <Text
                          style={{
                            flex: 1,
                            fontFamily: FONTS.bold,
                            fontSize: 12,
                            color: cleared ? "#86efac" : "#fca5a5",
                          }}
                        >
                          {rv.name}
                          {cleared ? " — checklist complete" : " — complete to start"}
                        </Text>
                      </View>
                      {cl.map((step, i) => {
                        const checked = !!checklistAcks[ackKey(rv.ruleId, i)];
                        return (
                          <Pressable
                            key={i}
                            onPress={() => toggleAck(rv.ruleId, i)}
                            style={{
                              flexDirection: "row",
                              alignItems: "flex-start",
                              gap: 8,
                            }}
                          >
                            <Feather
                              name={checked ? "check-square" : "square"}
                              size={16}
                              color={checked ? "#86efac" : colors.mutedForeground}
                            />
                            <Text
                              style={{
                                flex: 1,
                                fontFamily: FONTS.regular,
                                fontSize: 12,
                                color: colors.foreground,
                                textDecorationLine: checked ? "line-through" : "none",
                                opacity: checked ? 0.7 : 1,
                              }}
                            >
                              {step}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })()}

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

      <FloorMode
        visible={showFloorMode}
        onClose={() => setShowFloorMode(false)}
        run={run}
        labelText={label}
        calc={calc}
        supply={supply}
        activeStoppage={activeStoppage}
        allergenWarningCount={floorAllergenWarnings.length}
        onLogStop={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setShowModal(true);
        }}
        onEndStop={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          endActiveStoppage();
        }}
        onSkidDone={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          updateProgress({
            skidsCompleted: run.progress.skidsCompleted + 1,
            casesOnCurrentSkid: 0,
          });
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

  floorLaunch: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 8,
  },
  floorLaunchText: { fontFamily: FONTS.semibold, fontSize: 12 },
  topCard: { marginTop: 4 },
  sectionCard: { marginTop: 16 },

  casesWarn: { fontSize: 12, fontFamily: FONTS.semibold, marginTop: 10 },
  idLabel: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 8,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontFamily: FONTS.medium },
  addRow: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  addBtn: {
    width: 42,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  idEmpty: {
    fontSize: 13,
    fontFamily: FONTS.regular,
    fontStyle: "italic" as const,
    paddingVertical: 4,
  },
  profileBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 12,
    marginTop: 14,
  },
  profileBtnText: { fontSize: 14, fontFamily: FONTS.semibold },
  profileHint: { fontSize: 12, fontFamily: FONTS.regular, lineHeight: 16, marginTop: 8 },

  runNav: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 4,
    borderWidth: 1,
    marginTop: 12,
    overflow: "hidden",
  },
  navBtn: { padding: 12 },
  navCenter: { flex: 1, alignItems: "center", paddingVertical: 10 },
  navLabel: { fontSize: 15, fontFamily: FONTS.semibold, textAlign: "center" },
  navSubRow: { flexDirection: "row", alignItems: "center", marginTop: 1, gap: 5 },
  syncDot: { width: 6, height: 6, borderRadius: 3 },
  navSub: { fontSize: 11, fontFamily: FONTS.regular },
  navAddBtn: {
    margin: 8,
    width: 32,
    height: 32,
    borderRadius: 4,
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
  elapsed: { fontSize: 12, fontFamily: FONTS.mono, marginTop: 2 },
  batchDueBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  batchDueText: { flex: 1, fontFamily: FONTS.bold, fontSize: 14 },
  toggleBtn: { borderRadius: 4, paddingVertical: 9, paddingHorizontal: 18 },
  toggleText: { color: "#fff", fontFamily: FONTS.bold, fontSize: 13, letterSpacing: 0.3 },

  stoppageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 4,
    padding: 12,
    marginTop: 12,
    justifyContent: "center",
  },
  stoppageBannerText: { color: "#000", fontFamily: FONTS.bold, fontSize: 13 },

  carryCard: {
    borderRadius: 4,
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
    gap: 10,
  },
  carryHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  carryTitle: { fontSize: 14, fontFamily: FONTS.bold },
  carryBody: { fontSize: 14, fontFamily: FONTS.regular, lineHeight: 20 },
  carryStrong: { fontFamily: FONTS.bold },
  carryActions: { flexDirection: "row", gap: 10, marginTop: 2 },
  carryAccept: {
    flex: 1,
    borderRadius: 4,
    paddingVertical: 11,
    alignItems: "center",
  },
  carryAcceptText: { color: "#000", fontFamily: FONTS.bold, fontSize: 14 },
  carryDismiss: {
    borderRadius: 4,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  carryDismissText: { fontFamily: FONTS.semibold, fontSize: 14 },

  metricsRow: { flexDirection: "row", gap: 10 },
  metricBig: { flex: 1.3 },
  metricCol: { flex: 1, gap: 10 },

  targetBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 4,
  },
  targetBannerText: { fontSize: 14, fontFamily: FONTS.bold, flex: 1 },
  caseProgressWrap: { marginBottom: 6, gap: 6 },
  caseProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  caseProgressLabel: { fontSize: 12, fontFamily: FONTS.regular },
  caseProgressValue: { fontSize: 12, fontFamily: FONTS.monoBold, fontVariant: ["tabular-nums"] },
  caseProgressTrack: { height: 10, borderRadius: 999, overflow: "hidden" },
  caseProgressFill: { height: "100%", borderRadius: 999 },
  runDetailStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  runDetailStatusLabel: { fontSize: 13, fontFamily: FONTS.regular },
  runDetailStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  runDetailStatusText: { fontSize: 13, fontFamily: FONTS.semibold },

  runToTimeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  runToTimeLabel: { fontSize: 13, fontFamily: FONTS.regular },
  runToTimeInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  runToTimeHint: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 10 },
  runToTimeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  runToTimeStat: {
    flexBasis: "30%",
    flexGrow: 1,
    alignItems: "center",
  },
  runToTimeValue: { fontSize: 22, fontFamily: FONTS.monoBold, fontVariant: ["tabular-nums"] },
  runToTimeStatLabel: { fontSize: 11, fontFamily: FONTS.regular, marginTop: 2 },

  upcomingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  upcomingLabel: { fontSize: 15, fontFamily: FONTS.semibold },
  upcomingSub: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 2 },

  stoppageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 4,
    borderWidth: 1,
    padding: 14,
    justifyContent: "center",
    marginTop: 16,
  },
  stoppageBtnText: { fontSize: 15, fontFamily: FONTS.semibold },

  controlBar: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
  },
  controlKpi: { flex: 1, gap: 4 },
  controlKpiTop: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  controlKpiValue: {
    fontSize: 20,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
  },
  controlKpiPct: { fontSize: 13, fontFamily: FONTS.semibold },
  controlKpiTrack: { height: 6, borderRadius: 999, overflow: "hidden" },
  controlKpiFill: { height: "100%", borderRadius: 999 },
  controlKpiSub: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
  },
  controlActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  ctrlBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 6,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  ctrlBtnWide: { paddingHorizontal: 22 },
  ctrlBtnText: { fontSize: 14, fontFamily: FONTS.bold },

  notesCard: {
    borderRadius: 4,
    borderWidth: 1,
    padding: 14,
    marginTop: 16,
    gap: 6,
  },
  notesLabel: { fontSize: 10, fontFamily: FONTS.semibold, letterSpacing: 0.8 },
  notesText: { fontSize: 14, fontFamily: FONTS.regular, lineHeight: 20 },

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
  sheetTitle: { fontSize: 18, fontFamily: FONTS.bold, marginBottom: 20, textAlign: "center" },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
  },
  typeBtn: {
    borderRadius: 4,
    paddingVertical: 18,
    paddingHorizontal: 20,
    minWidth: "45%",
    alignItems: "center",
  },
  typeBtnText: { color: "#fff", fontFamily: FONTS.bold, fontSize: 16 },

  pickerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  pickerItem: {
    flex: 1,
    borderRadius: 4,
    borderWidth: 1,
    padding: 12,
  },
  pickerItemInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  pickerLabel: { fontSize: 15, fontFamily: FONTS.semibold },
  pickerSub: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 2 },
  pickerDelete: { padding: 12 },
});
