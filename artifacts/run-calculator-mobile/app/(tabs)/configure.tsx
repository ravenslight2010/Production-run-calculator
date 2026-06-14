import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CardSection,
  NumericField,
  RecipeEditor,
  SectionHeader,
  TextField,
} from "@/components/UI";
import {
  useRun,
  runLabel,
  type RecipeRow,
  type RunSettings,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { findMixPresets } from "@/data/mixPresets";

function toNum(s: string | undefined | null): number {
  if (s == null || s === "") return 0;
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

interface FormState {
  brand: string;
  flavor: string;
  dieType: string;
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
  // Dough/crust supply tracking
  doughballsPerTray: string;
  crustsPerStack: string;
  crustsPerCase: string;
  doughBatchYield: string;
  // Freezer
  freezerTime: string;
}

function n2s(n: number): string {
  return n > 0 ? n.toString() : "";
}

function settingsToForm(s: RunSettings): FormState {
  return {
    brand: s.brand,
    flavor: s.flavor,
    dieType: s.dieType ?? "",
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
    doughballsPerTray: n2s(s.doughballsPerTray),
    crustsPerStack: n2s(s.crustsPerStack),
    crustsPerCase: n2s(s.crustsPerCase),
    doughBatchYield: n2s(s.doughBatchYield),
    freezerTime: n2s(s.freezerTime),
  };
}

export default function ConfigureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    run,
    runIndex,
    updateSettings,
    templates,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
    dieTypes,
    cheeseIngredients,
    doughIngredients,
    frontlineIngredients,
    doughRecipePresets,
    cheeseRecipePresets,
    frontlineRecipePresets,
    mixRecipePresets,
    saveRecipePreset,
    deleteRecipePreset,
    supervisorPin,
  } = useRun();
  const [form, setForm] = useState<FormState>(() => settingsToForm(run.settings));
  const [tplName, setTplName] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [pinError, setPinError] = useState(false);

  // Keep the string form in sync whenever settings change externally
  // (profile auto-load on the Run screen, preset apply, reset). Editing form
  // fields locally doesn't touch settings until blur, so this won't clobber
  // typing.
  useEffect(() => {
    setForm(settingsToForm(run.settings));
  }, [run.settings]);

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
      dieType: form.dieType.trim(),
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
      doughballsPerTray: toNum(form.doughballsPerTray),
      crustsPerStack: toNum(form.crustsPerStack),
      crustsPerCase: toNum(form.crustsPerCase),
      doughBatchYield: toNum(form.doughBatchYield),
      freezerTime: toNum(form.freezerTime),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // Recipe editors write directly to run settings (no string-form intermediary)
  const cheeseNames = Object.keys(cheeseRecipePresets);
  const doughNames = Object.keys(doughRecipePresets);
  const frontlineNames = Object.keys(frontlineRecipePresets);

  // Factory mix presets matching the current brand + flavor, plus the user's
  // own saved mixes (shown together as one-tap chips in the cheese editor).
  const factoryMixPresets = findMixPresets(run.settings.brand, run.settings.flavor);
  const userMixPresets = Object.entries(mixRecipePresets).map(([name, ingredients]) => ({
    name,
    ingredients,
  }));
  const mixPresets = [...userMixPresets, ...factoryMixPresets];

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const currentLabel = runLabel(run, runIndex);

  const tryUnlock = () => {
    if (pinEntry === supervisorPin) {
      setUnlocked(true);
      setPinEntry("");
      setPinError(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setPinError(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  if (supervisorPin && !unlocked) {
    return (
      <View
        style={[
          styles.root,
          styles.lockRoot,
          { backgroundColor: colors.background, paddingTop: webTop + insets.top },
        ]}
      >
        <View
          style={[
            styles.lockCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="lock" size={32} color={colors.primary} />
          <Text style={[styles.lockTitle, { color: colors.foreground }]}>
            Supervisor PIN
          </Text>
          <Text style={[styles.lockHint, { color: colors.mutedForeground }]}>
            Enter the PIN to change run settings.
          </Text>
          <TextInput
            style={[
              styles.lockInput,
              {
                color: colors.foreground,
                borderColor: pinError ? "#ef4444" : colors.border,
              },
            ]}
            value={pinEntry}
            onChangeText={(t) => {
              setPinEntry(t);
              setPinError(false);
            }}
            placeholder="PIN"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
            textAlign="center"
            onSubmitEditing={tryUnlock}
            returnKeyType="go"
            autoFocus
          />
          {pinError ? (
            <Text style={styles.lockError}>Incorrect PIN. Try again.</Text>
          ) : null}
          <Pressable
            onPress={tryUnlock}
            disabled={!pinEntry.trim()}
            style={({ pressed }) => [
              styles.lockBtn,
              {
                backgroundColor: colors.primary,
                opacity: !pinEntry.trim() ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>
              Unlock
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

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

        {/* Templates */}
        <SectionHeader title="Templates" />
        <CardSection style={{ paddingVertical: 12 }}>
          {templates.length === 0 ? (
            <Text style={[styles.tplEmpty, { color: colors.mutedForeground }]}>
              Save this run&apos;s settings as a template to reuse them on future runs.
            </Text>
          ) : (
            <View style={{ gap: 8, marginBottom: 12 }}>
              {templates.map((t) => (
                <View
                  key={t.id}
                  style={[styles.tplRow, { borderColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.tplName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {t.name}
                    </Text>
                    <Text
                      style={[styles.tplMeta, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {[t.settings.brand, t.settings.flavor]
                        .filter(Boolean)
                        .join(" · ") || "Untitled run"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      applyTemplate(t.id);
                      setForm(settingsToForm(t.settings));
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Success,
                      );
                    }}
                    style={({ pressed }) => [
                      styles.tplApply,
                      { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={styles.tplApplyText}>Load</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      deleteTemplate(t.id);
                      Haptics.selectionAsync();
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.tplDelete,
                      { opacity: pressed ? 0.5 : 1 },
                    ]}
                  >
                    <Feather name="trash-2" size={16} color="#ef4444" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <View style={styles.tplSaveRow}>
            <TextInput
              style={[
                styles.tplInput,
                { color: colors.foreground, borderColor: colors.border },
              ]}
              value={tplName}
              onChangeText={setTplName}
              placeholder="Template name (optional)"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
            />
            <Pressable
              onPress={() => {
                saveTemplate(tplName);
                setTplName("");
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }}
              style={({ pressed }) => [
                styles.tplSaveBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.tplSaveBtnText}>Save Current</Text>
            </Pressable>
          </View>
        </CardSection>

        {/* Case Packing */}
        <SectionHeader title="Case Packing" />
        <CardSection>
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

        {/* Die Type */}
        <SectionHeader title="Die Type" />
        <CardSection style={{ paddingVertical: 12 }}>
          <View style={styles.chipRow}>
            {dieTypes.map((d) => {
              const active = form.dieType === d;
              return (
                <Pressable
                  key={d}
                  onPress={() => {
                    const next = active ? "" : d;
                    setForm((f) => ({ ...f, dieType: next }));
                    updateSettings({ dieType: next });
                    Haptics.selectionAsync();
                  }}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary + "22" : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.primary : colors.foreground },
                    ]}
                  >
                    {d}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
          <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
            Frontline recipe (overrides barrel weight when set)
          </Text>
          <RecipeEditor
            rows={run.settings.frontlineRecipe}
            onChange={(rows) => updateSettings({ frontlineRecipe: rows })}
            ingredientOptions={frontlineIngredients}
            name={run.settings.frontlineRecipeName}
            onNameChange={(n) => updateSettings({ frontlineRecipeName: n })}
            presetNames={frontlineNames}
            onSavePreset={() =>
              saveRecipePreset(
                "frontline",
                run.settings.frontlineRecipeName,
                run.settings.frontlineRecipe,
              )
            }
            onApplyPreset={(presetName) => {
              const rows = frontlineRecipePresets[presetName];
              if (rows)
                updateSettings({
                  frontlineRecipe: rows.map((r) => ({ ...r })),
                  frontlineRecipeName: presetName,
                });
            }}
            onDeletePreset={(presetName) =>
              deleteRecipePreset("frontline", presetName)
            }
            effectiveLabel="Effective barrel"
          />
        </CardSection>

        {/* Applicators 1–4 */}
        {[1, 2, 3, 4].map((n) => {
          const typeKey = `app${n}Type` as keyof FormState;
          const ozKey = `app${n}OzPerPizza` as keyof FormState;
          const lbsKey = `app${n}BatchLbs` as keyof FormState;
          const recipeKey = `app${n}CheeseRecipe` as keyof RunSettings;
          const recipeNameKey = `app${n}CheeseRecipeName` as keyof RunSettings;
          const rows = run.settings[recipeKey] as RecipeRow[];
          const recipeName = run.settings[recipeNameKey] as string;
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
                <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
                  Recipe (overrides batch weight when set)
                </Text>
                <RecipeEditor
                  rows={rows}
                  onChange={(r) =>
                    updateSettings({ [recipeKey]: r } as Partial<RunSettings>)
                  }
                  ingredientOptions={cheeseIngredients}
                  name={recipeName}
                  onNameChange={(nm) =>
                    updateSettings({ [recipeNameKey]: nm } as Partial<RunSettings>)
                  }
                  presetNames={cheeseNames}
                  onSavePreset={() =>
                    saveRecipePreset("cheese", recipeName, rows)
                  }
                  onApplyPreset={(presetName) => {
                    const preset = cheeseRecipePresets[presetName];
                    if (preset)
                      updateSettings({
                        [recipeKey]: preset.map((r) => ({ ...r })),
                        [recipeNameKey]: presetName,
                      } as Partial<RunSettings>);
                  }}
                  onDeletePreset={(presetName) =>
                    deleteRecipePreset("cheese", presetName)
                  }
                  factoryPresets={mixPresets}
                  factoryLabel={
                    userMixPresets.length > 0
                      ? "Your mixes + factory mixes"
                      : "Factory mixes for this brand + flavor"
                  }
                  onApplyFactory={(fp) =>
                    updateSettings({
                      [recipeKey]: fp.ingredients.map((r) => ({ ...r })),
                      [recipeNameKey]: fp.name,
                    } as Partial<RunSettings>)
                  }
                  onSaveMix={() => {
                    saveRecipePreset("mix", recipeName, rows);
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success,
                    );
                  }}
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
          <NumericField
            label="Doughballs per Tray"
            value={form.doughballsPerTray}
            onChangeText={set("doughballsPerTray")}
            onBlur={save}
            placeholder="0"
          />
          <NumericField
            label="Crusts per Stack"
            value={form.crustsPerStack}
            onChangeText={set("crustsPerStack")}
            onBlur={save}
            placeholder="0"
          />
          <NumericField
            label="Crusts per Case"
            value={form.crustsPerCase}
            onChangeText={set("crustsPerCase")}
            onBlur={save}
            placeholder="0"
          />
          <NumericField
            label="Dough Batch Yield"
            value={form.doughBatchYield}
            onChangeText={set("doughBatchYield")}
            onBlur={save}
            placeholder="0"
            unit="pizzas"
          />
          <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
            Dough recipe (overrides batch weight when set)
          </Text>
          <RecipeEditor
            rows={run.settings.doughRecipe}
            onChange={(rows) => updateSettings({ doughRecipe: rows })}
            ingredientOptions={doughIngredients}
            name={run.settings.doughRecipeName}
            onNameChange={(n) => updateSettings({ doughRecipeName: n })}
            presetNames={doughNames}
            onSavePreset={() =>
              saveRecipePreset(
                "dough",
                run.settings.doughRecipeName,
                run.settings.doughRecipe,
              )
            }
            onApplyPreset={(presetName) => {
              const rows = doughRecipePresets[presetName];
              if (rows)
                updateSettings({
                  doughRecipe: rows.map((r) => ({ ...r })),
                  doughRecipeName: presetName,
                });
            }}
            onDeletePreset={(presetName) =>
              deleteRecipePreset("dough", presetName)
            }
          />
        </CardSection>

        {/* Freezer */}
        <SectionHeader title="Freezer" />
        <CardSection>
          <NumericField
            label="Freezer Time"
            value={form.freezerTime}
            onChangeText={set("freezerTime")}
            onBlur={save}
            placeholder="15"
            unit="min"
          />
          <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
            Minutes pizzas spend in the freezer before they can be cased.
          </Text>
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

        {/* Save */}
        <Pressable
          onPress={save}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={styles.saveBtnText}>Save Settings</Text>
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

  lockRoot: { alignItems: "center", justifyContent: "center", padding: 24 },
  lockCard: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  lockTitle: { fontSize: 20, fontWeight: "700" as const, marginTop: 4 },
  lockHint: { fontSize: 13, textAlign: "center", marginBottom: 6 },
  lockInput: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    letterSpacing: 4,
  },
  lockError: { color: "#ef4444", fontSize: 13, fontWeight: "500" as const },
  lockBtn: {
    width: "100%",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  lockBtnText: { fontSize: 16, fontWeight: "700" as const },
  masterDataBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 12,
  },
  masterDataText: { flex: 1, fontSize: 15, fontWeight: "600" as const },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recipeHint: {
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
    fontStyle: "italic",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: "600" as const },

  tplEmpty: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  tplRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tplName: { fontSize: 15, fontWeight: "600" as const },
  tplMeta: { fontSize: 12, marginTop: 1 },
  tplApply: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tplApplyText: { color: "#000", fontSize: 13, fontWeight: "700" as const },
  tplDelete: { padding: 4 },
  tplSaveRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tplInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "web" ? 8 : 10,
    fontSize: 15,
  },
  tplSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  tplSaveBtnText: { color: "#000", fontSize: 13, fontWeight: "700" as const },
});
