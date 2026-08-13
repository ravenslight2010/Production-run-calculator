import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ReadOnlyRecipe, StatRow } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useRun, computeCalc, sauceBarrelBreakdown } from "@/context/RunContext";
import RecipeSubstitutionBadge from "@/components/RecipeSubstitutionBadge";
import { useColors } from "@/hooks/useColors";

/** Format seconds as M:SS */
function fmtSec(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "—:—";
  const s = Math.round(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function SauceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, substitutions, prepPhase, startPrep, addPrepBatchSauce } = useRun();

  // Live clock — ticks every second while the run is running.
  // calc.netElapsedSec is computed from this and is already pause-aware
  // (stoppages are subtracted), so we do NOT use wall-clock deltas anywhere.
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (!run.isRunning) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run.isRunning]);

  const calc = computeCalc(run, nowMs);

  // Barrel anchor stored in NET elapsed seconds (not wall-clock ms).
  // 0 means "since run start". pause-aware because calc.netElapsedSec freezes
  // during stoppages — no wall-clock timestamp involved.
  const lastBarrelNetSecRef = useRef<number>(0);
  const [barrelsMade, setBarrelsMade] = useState(0);
  const [showBarrelDue, setShowBarrelDue] = useState(false);
  const barrelDueKeyRef = useRef("");

  // Packaging quick check — same cadence as dough batch alert.
  const [showQuickCheck, setShowQuickCheck] = useState(false);
  const quickCheckKeyRef = useRef("");

  // ── Reset on run change ───────────────────────────────────────────────────
  const prevRunIdRef = useRef(run.id);
  if (prevRunIdRef.current !== run.id) {
    prevRunIdRef.current = run.id;
    lastBarrelNetSecRef.current = 0;
    setBarrelsMade(0);
    setShowBarrelDue(false);
    barrelDueKeyRef.current = "";
    quickCheckKeyRef.current = "";
    setShowQuickCheck(false);
  }

  // ── startedAt transition: handle tab mounted before run starts ────────────
  // When the crew opens the Sauce tab during prep and then starts the run,
  // the run ID doesn't change — only startedAt goes from null to a value.
  // Reset the barrel anchor so the countdown starts from 0 net elapsed.
  const prevStartedAtRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (prevStartedAtRef.current == null && run.startedAt != null) {
      // Run just started while this tab was already mounted.
      lastBarrelNetSecRef.current = 0;
      setBarrelsMade(0);
      setShowBarrelDue(false);
      barrelDueKeyRef.current = "";
      quickCheckKeyRef.current = "";
      setShowQuickCheck(false);
    }
    prevStartedAtRef.current = run.startedAt;
  }, [run.startedAt]);

  // ── Sauce barrel nearly-exhausted alert ──────────────────────────────────
  // Fire when < 15% of barrel time remains.
  // Uses calc.netElapsedSec (pause-aware) so paused time is not counted.
  // Suppressed once pressDone — the line is no longer consuming sauce.
  useEffect(() => {
    const depletionSec = calc.sauceDepletionSec;
    if (!run.isRunning || !run.startedAt || calc.pressDone || depletionSec <= 0) return;
    const barrelElapsed = Math.max(0, calc.netElapsedSec - lastBarrelNetSecRef.current);
    const secLeft = Math.max(0, depletionSec - barrelElapsed);
    const pctLeft = secLeft / depletionSec;
    if (pctLeft >= 0.15) return;
    const key = `${run.id}-${barrelsMade}`;
    if (barrelDueKeyRef.current === key) return;
    barrelDueKeyRef.current = key;
    setShowBarrelDue(true);
  }, [calc.netElapsedSec, run.isRunning, run.id, run.startedAt, calc.sauceDepletionSec, calc.pressDone, barrelsMade]);

  // Clear barrel alert as soon as the press is done — sauce consumption has stopped.
  useEffect(() => {
    if (calc.pressDone) setShowBarrelDue(false);
  }, [calc.pressDone]);

  // ── Packaging quick check (same cadence as dough batch alert) ────────────
  // Uses calc.netElapsedSec (pause-aware) — does not use wall-clock startedAt.
  useEffect(() => {
    const batchSec = calc.timePerBatchSec;
    if (!run.isRunning || !run.startedAt || batchSec <= 0 || calc.pressDone) return;
    const batchNum = Math.floor(calc.netElapsedSec / batchSec);
    if (batchNum < 1) return;
    const key = `${run.id}-${batchNum}`;
    if (quickCheckKeyRef.current === key) return;
    quickCheckKeyRef.current = key;
    setShowQuickCheck(true);
  }, [calc.netElapsedSec, run.isRunning, run.id, run.startedAt, calc.timePerBatchSec, calc.pressDone]);

  const hasSauce = run.settings.sauceOzPerPizza > 0 && calc.sauceLbs > 0;
  const sauceBarrels = sauceBarrelBreakdown(calc.sauceLbs, calc.sauceEffBarrel);
  const sauceValue = sauceBarrels
    ? `${calc.sauceBatches.toFixed(2)} batches · ${sauceBarrels.totalBarrels} barrel${sauceBarrels.totalBarrels === 1 ? "" : "s"}`
    : `${calc.sauceBatches.toFixed(2)} batches`;

  const recipeName = run.settings.frontlineRecipeName?.trim();

  // Barrel countdown — suppressed when press is done.
  // Uses calc.netElapsedSec (pause-aware) for the fill bar.
  const showBarrelTimer = run.isRunning && !calc.pressDone && calc.sauceDepletionSec > 0;
  const barrelElapsed = Math.max(0, calc.netElapsedSec - lastBarrelNetSecRef.current);
  const barrelSecLeft = Math.max(0, calc.sauceDepletionSec - barrelElapsed);
  const barrelPct = calc.sauceDepletionSec > 0
    ? Math.min(100, Math.max(0, (barrelElapsed / calc.sauceDepletionSec) * 100))
    : 0;
  const barrelNearlyEmpty = barrelPct > 85;

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
        <RecipeSubstitutionBadge
          substitutions={substitutions}
          recipes={[run.settings.frontlineRecipe]}
          typeValues={[]}
        />
        {/* Sauce prep section: shown while no production run is active */}
        {run.startedAt == null && (
          <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, marginBottom: 8 }}>
            <Text style={{ fontFamily: FONTS.bold, fontSize: 11, color: colors.mutedForeground, letterSpacing: 1, marginBottom: 8 }}>SAUCE PREP</Text>
            {prepPhase?.prepStartedAt == null ? (
              <Pressable
                onPress={startPrep}
                style={{ backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' }}
              >
                <Text style={{ color: '#000', fontFamily: FONTS.bold, fontSize: 13 }}>Start Prep</Text>
              </Pressable>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {prepPhase.prepBatchesSauce} of 1 batch ready
                </Text>
                {prepPhase.prepBatchesSauce < 1 && (
                  <Pressable
                    onPress={addPrepBatchSauce}
                    style={{ backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' }}
                  >
                    <Text style={{ color: '#000', fontFamily: FONTS.bold, fontSize: 13 }}>+1 Batch</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {/* Sauce barrel countdown timer — shown while production is running */}
        {showBarrelTimer && (
          <View style={[
            styles.barrelCard,
            { borderColor: barrelNearlyEmpty ? '#ef4444' : (colors.border ?? '#334155'), backgroundColor: colors.card },
          ]}>
            <View style={styles.barrelRow}>
              <Text style={[styles.barrelLabel, { color: colors.mutedForeground }]}>
                Current barrel lasts
              </Text>
              <Text style={[styles.barrelTime, { color: barrelNearlyEmpty ? '#f87171' : '#60a5fa' }]}>
                {fmtSec(barrelSecLeft)}
              </Text>
            </View>
            <View style={[styles.barrelTrack, { backgroundColor: (colors.muted ?? '#1e293b') }]}>
              <View
                style={[
                  styles.barrelFill,
                  {
                    width: `${barrelPct}%` as `${number}%`,
                    backgroundColor: barrelNearlyEmpty ? '#ef4444' : '#3b82f6',
                  },
                ]}
              />
            </View>
            {/* Mark barrel consumed — records net elapsed sec, not wall-clock */}
            <View style={styles.barrelConsume}>
              <Text style={[styles.barrelConsumeLabel, { color: colors.mutedForeground }]}>
                Barrels consumed: <Text style={{ color: colors.foreground, fontFamily: FONTS.mono }}>{barrelsMade}</Text>
              </Text>
              <Pressable
                onPress={() => {
                  lastBarrelNetSecRef.current = calc.netElapsedSec;
                  setBarrelsMade(n => n + 1);
                  setShowBarrelDue(false);
                }}
                style={{ backgroundColor: '#3b82f6', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: '#fff', fontFamily: FONTS.bold, fontSize: 12 }}>+1 Barrel</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Barrel nearly-empty alert */}
        {showBarrelDue && (
          <View style={[styles.alertBanner, { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)' }]}>
            <Text style={{ color: '#f87171', fontFamily: FONTS.semibold, fontSize: 12, flex: 1 }}>
              🍅 Start new barrel soon — current barrel nearly empty
            </Text>
            <Pressable onPress={() => setShowBarrelDue(false)} hitSlop={8}>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: FONTS.bold }}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Packaging quick check — same cadence as dough batch alert */}
        {showQuickCheck && (
          <View style={[styles.alertBanner, { borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.08)' }]}>
            <Text style={{ color: '#f59e0b', fontFamily: FONTS.semibold, fontSize: 12, flex: 1 }}>
              📦 Quick check: update skid and case count in Packaging
            </Text>
            <Pressable onPress={() => setShowQuickCheck(false)} hitSlop={8}>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: FONTS.bold }}>✕</Text>
            </Pressable>
          </View>
        )}

        <Card title="Sauce Needs" icon="droplet" style={{ marginBottom: 16 }}>
          {hasSauce ? (
            <StatRow label="Sauce" value={sauceValue} />
          ) : (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              Set sauce oz per pizza in Setup to see sauce needs.
            </Text>
          )}
        </Card>

        <Card title="Sauce Recipe" icon="clipboard">
          {recipeName ? (
            <Text style={[styles.recipeName, { color: colors.mutedForeground }]}>
              {recipeName}
            </Text>
          ) : null}
          <ReadOnlyRecipe rows={run.settings.frontlineRecipe ?? []} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  empty: { fontSize: 13, fontStyle: "italic" },
  recipeName: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    marginBottom: 8,
    textAlign: "right",
  },
  barrelCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  barrelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  barrelLabel: {
    fontSize: 11,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.5,
  },
  barrelTime: {
    fontSize: 14,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
  },
  barrelTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 2,
  },
  barrelFill: {
    height: "100%",
    borderRadius: 2,
  },
  barrelConsume: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  barrelConsumeLabel: {
    fontSize: 12,
  },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 8,
  },
});
