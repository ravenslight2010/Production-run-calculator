import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollViewCompat } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, NumericField, SectionHeader, TextField } from "@/components/UI";
import { useRun, type RunSettings } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

function toNum(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

interface FormState {
  label: string;
  casesNeeded: string;
  pizzasPerCase: string;
  casesPerSkid: string;
  lineSpeedPPM: string;
  sauceOzPerPizza: string;
  sauceBarrelLbs: string;
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
  doughBatchLbs: string;
  doughballWeightOz: string;
}

function settingsToForm(s: RunSettings, label: string): FormState {
  return {
    label,
    casesNeeded: s.casesNeeded > 0 ? s.casesNeeded.toString() : "",
    pizzasPerCase: s.pizzasPerCase > 0 ? s.pizzasPerCase.toString() : "",
    casesPerSkid: s.casesPerSkid > 0 ? s.casesPerSkid.toString() : "",
    lineSpeedPPM: s.lineSpeedPPM > 0 ? s.lineSpeedPPM.toString() : "",
    sauceOzPerPizza: s.sauceOzPerPizza > 0 ? s.sauceOzPerPizza.toString() : "",
    sauceBarrelLbs: s.sauceBarrelLbs > 0 ? s.sauceBarrelLbs.toString() : "",
    app1Type: s.app1Type,
    app1OzPerPizza: s.app1OzPerPizza > 0 ? s.app1OzPerPizza.toString() : "",
    app1BatchLbs: s.app1BatchLbs > 0 ? s.app1BatchLbs.toString() : "",
    app2Type: s.app2Type,
    app2OzPerPizza: s.app2OzPerPizza > 0 ? s.app2OzPerPizza.toString() : "",
    app2BatchLbs: s.app2BatchLbs > 0 ? s.app2BatchLbs.toString() : "",
    app3Type: s.app3Type,
    app3OzPerPizza: s.app3OzPerPizza > 0 ? s.app3OzPerPizza.toString() : "",
    app3BatchLbs: s.app3BatchLbs > 0 ? s.app3BatchLbs.toString() : "",
    app4Type: s.app4Type,
    app4OzPerPizza: s.app4OzPerPizza > 0 ? s.app4OzPerPizza.toString() : "",
    app4BatchLbs: s.app4BatchLbs > 0 ? s.app4BatchLbs.toString() : "",
    doughBatchLbs: s.doughBatchLbs > 0 ? s.doughBatchLbs.toString() : "",
    doughballWeightOz: s.doughballWeightOz > 0 ? s.doughballWeightOz.toString() : "",
  };
}

export default function ConfigureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, updateSettings, updateLabel, resetRun } = useRun();
  const [form, setForm] = useState<FormState>(() =>
    settingsToForm(run.settings, run.label),
  );

  useEffect(() => {
    setForm(settingsToForm(run.settings, run.label));
  }, [run.id]);

  const set = (key: keyof FormState) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const save = () => {
    updateLabel(form.label || "Run 1");
    updateSettings({
      casesNeeded: toNum(form.casesNeeded),
      pizzasPerCase: toNum(form.pizzasPerCase) || 12,
      casesPerSkid: toNum(form.casesPerSkid) || 48,
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
      doughBatchLbs: toNum(form.doughBatchLbs),
      doughballWeightOz: toNum(form.doughballWeightOz),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 40 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Run Info */}
        <SectionHeader title="Run Info" />
        <CardSection>
          <TextField
            label="Run Label"
            value={form.label}
            onChangeText={set("label")}
            onBlur={save}
            placeholder="Run 1"
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
        </CardSection>

        {/* Line Speed */}
        <SectionHeader title="Line Speed" />
        <CardSection>
          <NumericField
            label="Pizzas per Minute"
            value={form.lineSpeedPPM}
            onChangeText={set("lineSpeedPPM")}
            onBlur={save}
            placeholder="0"
            unit="ppm"
          />
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

        {/* Applicators */}
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
                  placeholder="Cheese / Mix / Pep / …"
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
              casesNeeded: 0, pizzasPerCase: 12, casesPerSkid: 48, lineSpeedPPM: 0,
              sauceOzPerPizza: 0, sauceBarrelLbs: 0,
              app1Type: "", app1OzPerPizza: 0, app1BatchLbs: 0,
              app2Type: "", app2OzPerPizza: 0, app2BatchLbs: 0,
              app3Type: "", app3OzPerPizza: 0, app3BatchLbs: 0,
              app4Type: "", app4OzPerPizza: 0, app4BatchLbs: 0,
              doughBatchLbs: 0, doughballWeightOz: 0,
            }, "Run 1"));
          }}
          style={({ pressed }) => [
            styles.resetBtn,
            { borderColor: colors.destructive, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.resetBtnText, { color: colors.destructive }]}>
            Reset Run
          </Text>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
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
  },
  resetBtnText: { fontSize: 16, fontWeight: "600" as const },
});
