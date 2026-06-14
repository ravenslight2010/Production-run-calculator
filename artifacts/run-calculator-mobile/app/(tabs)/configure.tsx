import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, NumericField, SectionHeader, TextField } from "@/components/UI";
import { useRun, runLabel, type RunSettings } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

function toNum(s: string | undefined | null): number {
  if (s == null || s === "") return 0;
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

interface FormState {
  brand: string;
  flavor: string;
  casesNeeded: string;
  pizzasPerCase: string;
  casesPerSkid: string;
  casesPerLayer: string;
  notes: string;
  // Line speed (machine params — PPM = crustsPerCycle * cycleSpeed * speedAdjustment)
  crustsPerCycle: string;
  cycleSpeed: string;
  speedAdjustment: string;
  // Direct PPM fallback (used when crustsPerCycle = 0)
  lineSpeedPPM: string;
  // Sauce
  sauceOzPerPizza: string;
  sauceBarrelLbs: string;
  // Applicators 1–4
  app1Type: string;
  app1OzPerPizza: string;
  app1BatchLbs: string;
  app2Type: string;
  app2OzPerPizza: string;
  app2BatchLbs: string;
  app3Type: string;
  app3OzPerPizza: string;
  app3BatchLbs: string;
  app4Type: string;
  app4OzPerPizza: string;
  app4BatchLbs: string;
  // Pepperoni 1–2
  pep1Type: string;
  pep1OzPerPizza: string;
  pep1Sticks: string;
  pep1BatchLbs: string;
  pep2Type: string;
  pep2OzPerPizza: string;
  pep2Sticks: string;
  pep2BatchLbs: string;
  // Dough
  doughBatchLbs: string;
  doughballWeightOz: string;
}

function n2s(n: number): string {
  return n > 0 ? n.toString() : "";
}

function settingsToForm(s: RunSettings): FormState {
  return {
    brand: s.brand,
    flavor: s.flavor,
    casesNeeded: n2s(s.casesNeeded),
    pizzasPerCase: n2s(s.pizzasPerCase),
    casesPerSkid: n2s(s.casesPerSkid),
    casesPerLayer: n2s(s.casesPerLayer),
    notes: s.notes,
    crustsPerCycle: n2s(s.crustsPerCycle),
    cycleSpeed: n2s(s.cycleSpeed),
    speedAdjustment: s.speedAdjustment !== 1 ? s.speedAdjustment.toString() : "1",
    lineSpeedPPM: n2s(s.lineSpeedPPM),
    sauceOzPerPizza: n2s(s.sauceOzPerPizza),
    sauceBarrelLbs: n2s(s.sauceBarrelLbs),
    app1Type: s.app1Type,
    app1OzPerPizza: n2s(s.app1OzPerPizza),
    app1BatchLbs: n2s(s.app1BatchLbs),
    app2Type: s.app2Type,
    app2OzPerPizza: n2s(s.app2OzPerPizza),
    app2BatchLbs: n2s(s.app2BatchLbs),
    app3Type: s.app3Type,
    app3OzPerPizza: n2s(s.app3OzPerPizza),
    app3BatchLbs: n2s(s.app3BatchLbs),
    app4Type: s.app4Type,
    app4OzPerPizza: n2s(s.app4OzPerPizza),
    app4BatchLbs: n2s(s.app4BatchLbs),
    pep1Type: s.pep1Type,
    pep1OzPerPizza: n2s(s.pep1OzPerPizza),
    pep1Sticks: n2s(s.pep1Sticks),
    pep1BatchLbs: s.pep1BatchLbs > 0 ? s.pep1BatchLbs.toString() : "25",
    pep2Type: s.pep2Type,
    pep2OzPerPizza: n2s(s.pep2OzPerPizza),
    pep2Sticks: n2s(s.pep2Sticks),
    pep2BatchLbs: s.pep2BatchLbs > 0 ? s.pep2BatchLbs.toString() : "25",
    doughBatchLbs: n2s(s.doughBatchLbs),
    doughballWeightOz: n2s(s.doughballWeightOz),
  };
}

export default function ConfigureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, runIndex, updateSettings, resetRun } = useRun();
  const [form, setForm] = useState<FormState>(() => settingsToForm(run.settings));

  useEffect(() => {
    setForm(settingsToForm(run.settings));
  }, [run.id]);

  const set = (key: keyof FormState) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const computedPPM =
    toNum(form.crustsPerCycle) > 0 && toNum(form.cycleSpeed) > 0
      ? toNum(form.crustsPerCycle) * toNum(form.cycleSpeed) * (toNum(form.speedAdjustment) || 1)
      : null;

  const save = () => {
    updateSettings({
      brand: form.brand.trim(),
      flavor: form.flavor.trim(),
      casesNeeded: toNum(form.casesNeeded),
      pizzasPerCase: toNum(form.pizzasPerCase) || 12,
      casesPerSkid: toNum(form.casesPerSkid) || 48,
      casesPerLayer: toNum(form.casesPerLayer) || 6,
      notes: form.notes.trim(),
      crustsPerCycle: toNum(form.crustsPerCycle),
      cycleSpeed: toNum(form.cycleSpeed),
      speedAdjustment: toNum(form.speedAdjustment) || 1,
      lineSpeedPPM: toNum(form.lineSpeedPPM),
      sauceOzPerPizza: toNum(form.sauceOzPerPizza),
      sauceBarrelLbs: toNum(form.sauceBarrelLbs),
      app1Type: form.app1Type.trim(),
      app1OzPerPizza: toNum(form.app1OzPerPizza),
      app1BatchLbs: toNum(form.app1BatchLbs),
      app2Type: form.app2Type.trim(),
      app2OzPerPizza: toNum(form.app2OzPerPizza),
      app2BatchLbs: toNum(form.app2BatchLbs),
      app3Type: form.app3Type.trim(),
      app3OzPerPizza: toNum(form.app3OzPerPizza),
      app3BatchLbs: toNum(form.app3BatchLbs),
      app4Type: form.app4Type.trim(),
      app4OzPerPizza: toNum(form.app4OzPerPizza),
      app4BatchLbs: toNum(form.app4BatchLbs),
      pep1Type: form.pep1Type.trim(),
      pep1OzPerPizza: toNum(form.pep1OzPerPizza),
      pep1Sticks: toNum(form.pep1Sticks),
      pep1BatchLbs: toNum(form.pep1BatchLbs) || 25,
      pep2Type: form.pep2Type.trim(),
      pep2OzPerPizza: toNum(form.pep2OzPerPizza),
      pep2Sticks: toNum(form.pep2Sticks),
      pep2BatchLbs: toNum(form.pep2BatchLbs) || 25,
      doughBatchLbs: toNum(form.doughBatchLbs),
      doughballWeightOz: toNum(form.doughballWeightOz),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const currentLabel = runLabel(run, runIndex);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 40 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Run header */}
        <View style={[styles.runHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.runHeaderLabel, { color: colors.mutedForeground }]}>
            CONFIGURING
          </Text>
          <Text style={[styles.runHeaderName, { color: colors.primary }]}>
            {currentLabel}
          </Text>
        </View>

        {/* Run Info */}
        <SectionHeader title="Run Info" />
        <CardSection>
          <TextField
            label="Brand"
            value={form.brand}
            onChangeText={set("brand")}
            onBlur={save}
            placeholder="Brand name"
          />
          <TextField
            label="Flavor"
            value={form.flavor}
            onChangeText={set("flavor")}
            onBlur={save}
            placeholder="Flavor"
          />
          <NumericField
            label="Cases Needed"
            value={form.casesNeeded}
            onChangeText={set("casesNeeded")}
            onBlur={save}
            placeholder="0"
          />
          <NumericField
            label="Pizzas per Case"
            value={form.pizzasPerCase}
            onChangeText={set("pizzasPerCase")}
            onBlur={save}
            placeholder="12"
          />
          <NumericField
            label="Cases per Skid"
            value={form.casesPerSkid}
            onChangeText={set("casesPerSkid")}
            onBlur={save}
            placeholder="48"
          />
          <NumericField
            label="Cases per Layer"
            value={form.casesPerLayer}
            onChangeText={set("casesPerLayer")}
            onBlur={save}
            placeholder="6"
            unit="(buffer)"
          />
        </CardSection>

        {/* Line Speed */}
        <SectionHeader title="Line Speed" />
        <CardSection>
          <NumericField
            label="Crusts per Cycle"
            value={form.crustsPerCycle}
            onChangeText={set("crustsPerCycle")}
            onBlur={save}
            placeholder="0"
          />
          <NumericField
            label="Cycle Speed"
            value={form.cycleSpeed}
            onChangeText={set("cycleSpeed")}
            onBlur={save}
            placeholder="0.0"
            unit="cyc/min"
          />
          <NumericField
            label="Speed Adjustment"
            value={form.speedAdjustment}
            onChangeText={set("speedAdjustment")}
            onBlur={save}
            placeholder="1.0"
            unit="×"
          />
          {computedPPM !== null ? (
            <View style={[styles.computedRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.computedLabel, { color: colors.mutedForeground }]}>
                Computed PPM
              </Text>
              <Text style={[styles.computedValue, { color: colors.primary }]}>
                {computedPPM.toFixed(1)}
              </Text>
            </View>
          ) : (
            <NumericField
              label="Direct PPM"
              value={form.lineSpeedPPM}
              onChangeText={set("lineSpeedPPM")}
              onBlur={save}
              placeholder="0"
              unit="ppm"
            />
          )}
        </CardSection>

        {/* Sauce */}
        <SectionHeader title="Sauce" />
        <CardSection>
          <NumericField
            label="Oz per Pizza"
            value={form.sauceOzPerPizza}
            onChangeText={set("sauceOzPerPizza")}
            onBlur={save}
            placeholder="0.0"
            unit="oz"
          />
          <NumericField
            label="Barrel Weight"
            value={form.sauceBarrelLbs}
            onChangeText={set("sauceBarrelLbs")}
            onBlur={save}
            placeholder="0"
            unit="lbs"
          />
        </CardSection>

        {/* Applicators 1–4 */}
        {[1, 2, 3, 4].map((n) => {
          const typeKey = `app${n}Type` as keyof FormState;
          const ozKey = `app${n}OzPerPizza` as keyof FormState;
          const lbsKey = `app${n}BatchLbs` as keyof FormState;
          return (
            <React.Fragment key={n}>
              <SectionHeader title={`Applicator ${n}`} />
              <CardSection>
                <TextField
                  label="Type"
                  value={form[typeKey] as string}
                  onChangeText={set(typeKey)}
                  onBlur={save}
                  placeholder="Cheese / Mix / …"
                />
                <NumericField
                  label="Oz per Pizza"
                  value={form[ozKey] as string}
                  onChangeText={set(ozKey)}
                  onBlur={save}
                  placeholder="0.0"
                  unit="oz"
                />
                <NumericField
                  label="Batch Weight"
                  value={form[lbsKey] as string}
                  onChangeText={set(lbsKey)}
                  onBlur={save}
                  placeholder="0"
                  unit="lbs"
                />
              </CardSection>
            </React.Fragment>
          );
        })}

        {/* Pepperoni 1 */}
        <SectionHeader title="Pepperoni 1" />
        <CardSection>
          <TextField
            label="Type"
            value={form.pep1Type}
            onChangeText={set("pep1Type")}
            onBlur={save}
            placeholder="Pep - Cured / Pep - Natural"
          />
          <NumericField
            label="Oz per Pizza"
            value={form.pep1OzPerPizza}
            onChangeText={set("pep1OzPerPizza")}
            onBlur={save}
            placeholder="0.0"
            unit="oz"
          />
          <NumericField
            label="Sticks (flat buffer)"
            value={form.pep1Sticks}
            onChangeText={set("pep1Sticks")}
            onBlur={save}
            placeholder="0"
            unit="sticks"
          />
          <NumericField
            label="Batch Weight"
            value={form.pep1BatchLbs}
            onChangeText={set("pep1BatchLbs")}
            onBlur={save}
            placeholder="25"
            unit="lbs"
          />
        </CardSection>

        {/* Pepperoni 2 */}
        <SectionHeader title="Pepperoni 2" />
        <CardSection>
          <TextField
            label="Type"
            value={form.pep2Type}
            onChangeText={set("pep2Type")}
            onBlur={save}
            placeholder="Pep - Cured / Pep - Natural"
          />
          <NumericField
            label="Oz per Pizza"
            value={form.pep2OzPerPizza}
            onChangeText={set("pep2OzPerPizza")}
            onBlur={save}
            placeholder="0.0"
            unit="oz"
          />
          <NumericField
            label="Sticks (flat buffer)"
            value={form.pep2Sticks}
            onChangeText={set("pep2Sticks")}
            onBlur={save}
            placeholder="0"
            unit="sticks"
          />
          <NumericField
            label="Batch Weight"
            value={form.pep2BatchLbs}
            onChangeText={set("pep2BatchLbs")}
            onBlur={save}
            placeholder="25"
            unit="lbs"
          />
        </CardSection>

        {/* Dough */}
        <SectionHeader title="Dough" />
        <CardSection>
          <NumericField
            label="Batch Weight"
            value={form.doughBatchLbs}
            onChangeText={set("doughBatchLbs")}
            onBlur={save}
            placeholder="0"
            unit="lbs"
          />
          <NumericField
            label="Doughball Weight"
            value={form.doughballWeightOz}
            onChangeText={set("doughballWeightOz")}
            onBlur={save}
            placeholder="0.0"
            unit="oz"
          />
        </CardSection>

        {/* Notes */}
        <SectionHeader title="Notes" />
        <CardSection>
          <TextField
            label="Notes"
            value={form.notes}
            onChangeText={set("notes")}
            onBlur={save}
            placeholder="Any notes for this run…"
          />
        </CardSection>

        {/* Save + Reset */}
        <Pressable
          onPress={save}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={styles.saveBtnText}>Save Settings</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            resetRun();
            setForm(settingsToForm({
              brand: "", flavor: "", notes: "",
              casesNeeded: 0, pizzasPerCase: 12, casesPerSkid: 48, casesPerLayer: 6,
              lineSpeedPPM: 0, crustsPerCycle: 0, cycleSpeed: 0, speedAdjustment: 1,
              sauceOzPerPizza: 0, sauceBarrelLbs: 0,
              app1Type: "", app1OzPerPizza: 0, app1BatchLbs: 0,
              app2Type: "", app2OzPerPizza: 0, app2BatchLbs: 0,
              app3Type: "", app3OzPerPizza: 0, app3BatchLbs: 0,
              app4Type: "", app4OzPerPizza: 0, app4BatchLbs: 0,
              pep1Type: "", pep1OzPerPizza: 0, pep1Sticks: 0, pep1BatchLbs: 25,
              pep2Type: "", pep2OzPerPizza: 0, pep2Sticks: 0, pep2BatchLbs: 25,
              doughBatchLbs: 0, doughballWeightOz: 0,
            }));
          }}
          style={({ pressed }) => [
            styles.resetBtn,
            { borderColor: "#ef4444", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.resetBtnText, { color: "#ef4444" }]}>
            Reset This Run
          </Text>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  runHeader: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 4,
    alignItems: "center",
    gap: 2,
  },
  runHeaderLabel: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 1 },
  runHeaderName: { fontSize: 17, fontWeight: "700" as const },

  computedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "space-between",
  },
  computedLabel: { fontSize: 16, fontWeight: "500" as const },
  computedValue: { fontSize: 22, fontWeight: "700" as const },

  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" as const },
  resetBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  resetBtnText: { fontSize: 16, fontWeight: "600" as const },
});
