import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CardSection,
  NumericField,
  ReadOnlyRecipe,
  RecipeEditor,
  SectionHeader,
  SelectField,
  TextField,
} from "@/components/UI";
import {
  useRun,
  PACKAGING_FIELDS,
  DEFAULT_SETTINGS,
  type RecipeRow,
  type RunSettings,
} from "@/context/RunContext";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useMixes } from "@/hooks/useMixes";
import { useCheeseRecipes } from "@/hooks/useCheeseRecipes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { useMe } from "@/hooks/useRole";
import { allergenOptions, normalizeAllergen } from "@workspace/allergen";

function toNum(s: string | undefined | null): number {
  if (s == null || s === "") return 0;
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function n2s(n: number): string {
  return n > 0 ? n.toString() : "";
}

interface FormState {
  casesNeeded: string;
  pizzasPerCase: string;
  casesPerSkid: string;
  casesPerLayer: string;
  notes: string;
  crustsPerCycle: string;
  cycleSpeed: string;
  speedAdjustment: string;
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
  pep1Type: string;
  pep1OzPerPizza: string;
  pep1Sticks: string;
  pep1BatchLbs: string;
  pep2Type: string;
  pep2OzPerPizza: string;
  pep2Sticks: string;
  pep2BatchLbs: string;
  doughBatchLbs: string;
  doughballWeightOz: string;
  doughballsPerTray: string;
  crustsPerStack: string;
  crustsPerCase: string;
  doughBatchYield: string;
  freezerTime: string;
  cartonsPerCase: string;
}

function settingsToForm(s: RunSettings): FormState {
  return {
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
    cartonsPerCase: n2s(s.cartonsPerCase),
  };
}

/**
 * Standalone Setup Profiles editor (mobile mirror of the web
 * SetupProfileEditor). Lets a manager/supervisor pick any brand/flavor
 * (existing or new) and edit its saved setup directly via saveProfileFor /
 * loadProfileFor — never touches the current run.
 */
export default function SetupProfilesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ brand?: string; flavor?: string }>();
  const {
    brands,
    brandFlavors,
    brandProfiles,
    addListItem,
    removeListItem,
    addFlavor,
    removeFlavor,
    dieTypes,
    pepTypes,
    cheeseIngredients,
    doughIngredients,
    frontlineIngredients,
    doughRecipePresets,
    cheeseRecipePresets,
    frontlineRecipePresets,
    saveRecipePreset,
    deleteRecipePreset,
    saveProfileFor,
    loadProfileFor,
    supervisorPin,
  } = useRun();
  const { isManager } = useMe();
  const { items: serverMixes } = useMixes();
  const { items: cheeseRecipesList } = useCheeseRecipes();

  const [brand, setBrand] = useState(params.brand ?? "");
  const [flavor, setFlavor] = useState(params.flavor ?? "");
  const [settings, setSettings] = useState<RunSettings>(() =>
    loadProfileFor(params.brand ?? "", params.flavor ?? ""),
  );
  const [form, setForm] = useState<FormState>(() => settingsToForm(settings));
  const [unlocked, setUnlocked] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [pinError, setPinError] = useState(false);

  // Reload the saved profile whenever the picked brand/flavor changes.
  useEffect(() => {
    const next = loadProfileFor(brand.trim(), flavor.trim());
    setSettings(next);
    setForm(settingsToForm(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, flavor]);

  const updateSettings = (patch: Partial<RunSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  const set = (key: keyof FormState) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const commitForm = () => {
    setSettings((prev) => ({
      ...prev,
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
      cartonsPerCase: toNum(form.cartonsPerCase),
    }));
  };

  const computedPPM =
    toNum(form.crustsPerCycle) > 0 && toNum(form.cycleSpeed) > 0
      ? toNum(form.crustsPerCycle) * toNum(form.cycleSpeed) * (toNum(form.speedAdjustment) || 1)
      : null;

  const currentAllergen = normalizeAllergen(settings.allergen);
  // Custom allergens (beyond egg/soy) already used by saved profiles, so an
  // imported/new allergen stays selectable (and re-selectable) in the picker.
  const allergenChoices = allergenOptions([
    ...Object.values(brandProfiles).map((p) => p.allergen ?? "none"),
    currentAllergen,
  ]);

  const enabledCheeseRecipes = cheeseRecipesList.filter((r) => r.enabled !== false);
  const serverCheeseByName = new Map<string, CheeseRecipe>();
  for (const r of enabledCheeseRecipes) {
    const key = r.name.trim().toLowerCase();
    if (key) serverCheeseByName.set(key, r);
  }
  const serverCheeseRowsByName = new Map<string, RecipeRow[]>();
  for (const r of enabledCheeseRecipes) {
    const key = r.name.trim().toLowerCase();
    // Fall back to the per-pizza-oz column when a spec-created recipe has no
    // batch pounds yet — mirrors the run-screen cheese pick hydration.
    const hasBatchLbs = r.components.some((c) => Number(c.lbs) > 0);
    if (key)
      serverCheeseRowsByName.set(
        key,
        r.components
          .filter((c) => c.ingredient.trim())
          .map((c) => ({
            ingredient: c.ingredient,
            lbs: hasBatchLbs ? c.lbs : (c.ozPerPizza ?? 0),
          })),
      );
  }
  const serverCheeseNames = [
    ...new Set(enabledCheeseRecipes.map((r) => r.name.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const cheeseNamesForRun = (b: string, f: string): string[] => {
    const bl = b.trim().toLowerCase();
    const fl = f.trim().toLowerCase();
    if (!bl) return serverCheeseNames;
    const brandMatches = enabledCheeseRecipes.filter((r) => r.brand.trim().toLowerCase() === bl);
    if (brandMatches.length === 0) return serverCheeseNames;
    const flavorMatches = fl
      ? brandMatches.filter(
          (r) => !r.flavors || r.flavors.length === 0 || r.flavors.some((fv) => fv.trim().toLowerCase() === fl),
        )
      : brandMatches;
    const pool = flavorMatches.length > 0 ? flavorMatches : brandMatches;
    return [...new Set(pool.map((r) => r.name.trim()).filter(Boolean))].sort((a, b2) => a.localeCompare(b2));
  };

  const cheeseNames = Object.keys(cheeseRecipePresets);
  const doughNames = Object.keys(doughRecipePresets);
  const frontlineNames = Object.keys(frontlineRecipePresets);
  const serverMixPresets = serverMixes.map((m) => ({
    name: m.name,
    ingredients: (m.components ?? [])
      .filter((c) => c.ingredient.trim())
      .map((c) => ({ ingredient: c.ingredient, lbs: c.perPizza })),
  }));

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const tryUnlock = () => {
    if (pinEntry.trim() === (supervisorPin ?? "").trim()) {
      setUnlocked(true);
      setPinError(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setPinError(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const isSupervisor = isManager || !supervisorPin || unlocked;

  const save = () => {
    commitForm();
    const b = brand.trim();
    const f = flavor.trim();
    if (!b || !f) return;
    if (!brands.includes(b)) addListItem("brands", b);
    if (!(brandFlavors[b] ?? []).includes(f)) addFlavor(b, f);
    saveProfileFor(b, f, { ...settings, brand: b, flavor: f });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  if (!isSupervisor) {
    return (
      <View
        style={[
          styles.root,
          styles.lockRoot,
          { backgroundColor: colors.background, paddingTop: webTop + insets.top },
        ]}
      >
        <Stack.Screen options={{ title: "Setup Profiles", headerShown: true }} />
        <View style={[styles.lockCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="lock" size={32} color={colors.primary} />
          <Text style={[styles.lockTitle, { color: colors.foreground }]}>Supervisor PIN</Text>
          <Text style={[styles.lockHint, { color: colors.mutedForeground }]}>
            Enter the PIN to edit setup profiles.
          </Text>
          <TextInput
            style={[
              styles.lockInput,
              { color: colors.foreground, borderColor: pinError ? "#ef4444" : colors.border },
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
          {pinError ? <Text style={styles.lockError}>Incorrect PIN. Try again.</Text> : null}
          <Pressable
            onPress={tryUnlock}
            disabled={!pinEntry.trim()}
            style={({ pressed }) => [
              styles.lockBtn,
              { backgroundColor: colors.primary, opacity: !pinEntry.trim() ? 0.4 : pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>Unlock</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Setup Profiles", headerShown: true }} />
      <KeyboardAwareScrollViewCompat
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 40 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Pick any brand and flavor to edit its saved setup directly — this does
          not change the current run.
        </Text>

        {/* Brand / Flavor picker */}
        <SectionHeader title="Brand & Flavor" />
        <CardSection>
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.pickLabel, { color: colors.mutedForeground }]}>Brand</Text>
            <SelectField
              value={brand}
              onChange={(v) => {
                setBrand(v);
                setFlavor("");
                Haptics.selectionAsync();
              }}
              options={brands}
              onAddOption={(v) => {
                if (!brands.includes(v)) addListItem("brands", v);
                setBrand(v);
              }}
              onRemoveOption={(v) => removeListItem("brands", v)}
              placeholder="Select or add a brand…"
            />
          </View>
          <View>
            <Text style={[styles.pickLabel, { color: colors.mutedForeground }]}>Flavor</Text>
            {brand.trim() ? (
              <SelectField
                value={flavor}
                onChange={(v) => {
                  setFlavor(v);
                  Haptics.selectionAsync();
                }}
                options={brandFlavors[brand.trim()] ?? []}
                onAddOption={(v) => {
                  const b = brand.trim();
                  if (b && !(brandFlavors[b] ?? []).includes(v)) addFlavor(b, v);
                  setFlavor(v);
                }}
                onRemoveOption={(v) => removeFlavor(brand.trim(), v)}
                placeholder="Select or add a flavor…"
              />
            ) : (
              <Text style={[styles.pickEmpty, { color: colors.mutedForeground }]}>
                Pick a brand first.
              </Text>
            )}
          </View>
        </CardSection>

        {!brand.trim() || !flavor.trim() ? null : (
          <>
            {/* Case Packing */}
            <SectionHeader title="Case Packing" />
            <CardSection>
              <NumericField
                label="Pizzas per Case"
                value={form.pizzasPerCase}
                onChangeText={set("pizzasPerCase")}
                onBlur={commitForm}
                placeholder="12"
              />
              <NumericField
                label="Cases per Skid"
                value={form.casesPerSkid}
                onChangeText={set("casesPerSkid")}
                onBlur={commitForm}
                placeholder="48"
              />
              <NumericField
                label="Cases per Layer"
                value={form.casesPerLayer}
                onChangeText={set("casesPerLayer")}
                onBlur={commitForm}
                placeholder="6"
                unit="(buffer)"
              />
            </CardSection>

            {/* Packaging Settings */}
            <SectionHeader title="Packaging Settings" />
            {PACKAGING_FIELDS.map((f) => {
              const cur = (settings[f.name] as string) ?? "";
              return (
                <View key={f.name} style={{ marginBottom: 14 }}>
                  <Text
                    style={{
                      fontFamily: FONTS.semibold,
                      fontSize: 12,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: colors.mutedForeground,
                      marginBottom: 8,
                      marginLeft: 4,
                    }}
                  >
                    {f.label}
                  </Text>
                  <View style={styles.chipRow}>
                    {f.options.map((opt) => {
                      const active = cur === opt;
                      return (
                        <Pressable
                          key={opt}
                          onPress={() => {
                            updateSettings({ [f.name]: active ? "" : opt } as Partial<RunSettings>);
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
                            {opt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
            <CardSection>
              <NumericField
                label="Cartons per Case"
                value={form.cartonsPerCase}
                onChangeText={set("cartonsPerCase")}
                onBlur={commitForm}
                placeholder="0"
              />
            </CardSection>

            {/* Die Type */}
            <SectionHeader title="Die Type" />
            <CardSection style={{ paddingVertical: 12 }}>
              <SelectField
                value={settings.dieType}
                onChange={(v) => {
                  updateSettings({ dieType: v });
                  Haptics.selectionAsync();
                }}
                options={dieTypes}
                onAddOption={(v) => addListItem("dieTypes", v)}
                onRemoveOption={(v) => removeListItem("dieTypes", v)}
                allowClear
                placeholder="Select or add a die type…"
              />
            </CardSection>

            {/* Allergen */}
            <SectionHeader title="Allergen" />
            <CardSection style={{ paddingVertical: 12 }}>
              <SelectField
                value={currentAllergen}
                onChange={(v) => {
                  updateSettings({ allergen: normalizeAllergen(v) });
                  Haptics.selectionAsync();
                }}
                options={allergenChoices.map((m) => m.value)}
                optionLabel={(v) => allergenChoices.find((m) => m.value === v)?.label ?? v}
                optionColor={(v) => allergenChoices.find((m) => m.value === v)?.color}
                allowAdd={false}
              />
            </CardSection>

            {/* Line Speed */}
            <SectionHeader title="Line Speed" />
            <CardSection>
              <NumericField
                label="Crusts per Cycle"
                value={form.crustsPerCycle}
                onChangeText={set("crustsPerCycle")}
                onBlur={commitForm}
                placeholder="0"
              />
              <NumericField
                label="Cycle Speed"
                value={form.cycleSpeed}
                onChangeText={set("cycleSpeed")}
                onBlur={commitForm}
                placeholder="0.0"
                unit="cyc/min"
              />
              <NumericField
                label="Speed Adjustment"
                value={form.speedAdjustment}
                onChangeText={set("speedAdjustment")}
                onBlur={commitForm}
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
                  onBlur={commitForm}
                  placeholder="0"
                  unit="ppm"
                />
              )}
            </CardSection>

            {/* Dough Recipe */}
            <SectionHeader title="Dough Recipe" />
            <CardSection>
              <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
                Dough recipe (overrides batch weight when set)
              </Text>
              <RecipeEditor
                rows={settings.doughRecipe}
                onChange={(rows) => updateSettings({ doughRecipe: rows })}
                ingredientOptions={doughIngredients}
                onAddIngredient={(v) => addListItem("doughIngredients", v)}
                onRemoveIngredient={(v) => removeListItem("doughIngredients", v)}
                name={settings.doughRecipeName}
                onNameChange={(n) => updateSettings({ doughRecipeName: n })}
                presetNames={doughNames}
                onSavePreset={() =>
                  saveRecipePreset("dough", settings.doughRecipeName, settings.doughRecipe)
                }
                onApplyPreset={(presetName) => {
                  const rows = doughRecipePresets[presetName];
                  if (rows)
                    updateSettings({
                      doughRecipe: rows.map((r) => ({ ...r })),
                      doughRecipeName: presetName,
                    });
                }}
                onDeletePreset={(presetName) => deleteRecipePreset("dough", presetName)}
              />
            </CardSection>

            {/* Sauce */}
            <SectionHeader title="Sauce" />
            <CardSection>
              <NumericField
                label="Oz per Pizza"
                value={form.sauceOzPerPizza}
                onChangeText={set("sauceOzPerPizza")}
                onBlur={commitForm}
                placeholder="0.0"
                unit="oz"
              />
              <NumericField
                label="Barrel Weight"
                value={form.sauceBarrelLbs}
                onChangeText={set("sauceBarrelLbs")}
                onBlur={commitForm}
                placeholder="0"
                unit="lbs"
              />
              <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
                Frontline recipe (overrides barrel weight when set)
              </Text>
              <RecipeEditor
                rows={settings.frontlineRecipe}
                onChange={(rows) => updateSettings({ frontlineRecipe: rows })}
                ingredientOptions={frontlineIngredients}
                onAddIngredient={(v) => addListItem("frontlineIngredients", v)}
                onRemoveIngredient={(v) => removeListItem("frontlineIngredients", v)}
                name={settings.frontlineRecipeName}
                onNameChange={(n) => updateSettings({ frontlineRecipeName: n })}
                presetNames={frontlineNames}
                onSavePreset={() =>
                  saveRecipePreset("frontline", settings.frontlineRecipeName, settings.frontlineRecipe)
                }
                onApplyPreset={(presetName) => {
                  const rows = frontlineRecipePresets[presetName];
                  if (rows)
                    updateSettings({
                      frontlineRecipe: rows.map((r) => ({ ...r })),
                      frontlineRecipeName: presetName,
                    });
                }}
                onDeletePreset={(presetName) => deleteRecipePreset("frontline", presetName)}
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
              const rows = settings[recipeKey] as RecipeRow[];
              const recipeName = settings[recipeNameKey] as string;
              const isMixApplicator = (form[typeKey] as string).toLowerCase().includes("mix");
              const pickedCheese = recipeName.trim()
                ? serverCheeseByName.get(recipeName.trim().toLowerCase())
                : undefined;
              const scopedCheeseNames = cheeseNamesForRun(settings.brand ?? "", settings.flavor ?? "");
              const cheeseOptionsForApp =
                recipeName.trim() && !scopedCheeseNames.includes(recipeName)
                  ? [recipeName, ...scopedCheeseNames]
                  : scopedCheeseNames;
              return (
                <React.Fragment key={n}>
                  <SectionHeader title={`Applicator ${n}`} />
                  <CardSection>
                    <TextField
                      label="Type"
                      value={form[typeKey] as string}
                      onChangeText={set(typeKey)}
                      onBlur={commitForm}
                      placeholder="Cheese / Mix / …"
                    />
                    <NumericField
                      label="Oz per Pizza"
                      value={form[ozKey] as string}
                      onChangeText={set(ozKey)}
                      onBlur={commitForm}
                      placeholder="0.0"
                      unit="oz"
                    />
                    <NumericField
                      label="Batch Weight"
                      value={form[lbsKey] as string}
                      onChangeText={set(lbsKey)}
                      onBlur={commitForm}
                      placeholder="0"
                      unit="lbs"
                    />
                    {isMixApplicator ? (
                      <>
                        <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
                          Recipe (overrides batch weight when set)
                        </Text>
                        <RecipeEditor
                          rows={rows}
                          onChange={(r) => updateSettings({ [recipeKey]: r } as Partial<RunSettings>)}
                          ingredientOptions={cheeseIngredients}
                          onAddIngredient={(v) => addListItem("cheeseIngredients", v)}
                          onRemoveIngredient={(v) => removeListItem("cheeseIngredients", v)}
                          name={recipeName}
                          onNameChange={(nm) =>
                            updateSettings({ [recipeNameKey]: nm } as Partial<RunSettings>)
                          }
                          presetNames={cheeseNames}
                          onSavePreset={() => saveRecipePreset("cheese", recipeName, rows)}
                          onApplyPreset={(presetName) => {
                            const preset = cheeseRecipePresets[presetName];
                            if (preset)
                              updateSettings({
                                [recipeKey]: preset.map((r) => ({ ...r })),
                                [recipeNameKey]: presetName,
                              } as Partial<RunSettings>);
                          }}
                          onDeletePreset={(presetName) => deleteRecipePreset("cheese", presetName)}
                          factoryPresets={serverMixPresets}
                          factoryLabel="Mixes"
                          onApplyFactory={(fp) =>
                            updateSettings({
                              [recipeKey]: fp.ingredients.map((r) => ({ ...r })),
                              [recipeNameKey]: fp.name,
                            } as Partial<RunSettings>)
                          }
                        />
                      </>
                    ) : (
                      <>
                        <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
                          Cheese Blend — pick a recipe (managers add these under
                          Manage Lists → Cheese Recipes)
                        </Text>
                        <SelectField
                          label="Cheese Recipe"
                          value={recipeName}
                          onChange={(val) => {
                            const hydrated = val.trim()
                              ? serverCheeseRowsByName.get(val.trim().toLowerCase())
                              : undefined;
                            updateSettings({
                              [recipeNameKey]: val,
                              [recipeKey]: (hydrated ?? []).map((r) => ({ ...r })),
                            } as Partial<RunSettings>);
                          }}
                          options={cheeseOptionsForApp}
                          allowAdd={false}
                          allowClear
                          placeholder="Pick a cheese recipe…"
                        />
                        {pickedCheese && (pickedCheese.shredderSetting.trim() || pickedCheese.cellulose.trim()) ? (
                          <View style={styles.cheeseMetaRow}>
                            {pickedCheese.shredderSetting.trim() ? (
                              <Text style={[styles.cheeseMeta, { color: colors.mutedForeground }]}>
                                Shredder setting:{" "}
                                <Text style={[styles.cheeseMetaVal, { color: colors.foreground }]}>
                                  {pickedCheese.shredderSetting}
                                </Text>
                              </Text>
                            ) : null}
                            {pickedCheese.cellulose.trim() ? (
                              <Text style={[styles.cheeseMeta, { color: colors.mutedForeground }]}>
                                Cellulose:{" "}
                                <Text style={[styles.cheeseMetaVal, { color: colors.foreground }]}>
                                  {pickedCheese.cellulose}
                                </Text>
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                        <ReadOnlyRecipe
                          rows={rows}
                          emptyText={
                            recipeName.trim()
                              ? "This cheese recipe has no ingredients yet. A manager can edit it under Manage Lists → Cheese Recipes."
                              : "Pick a cheese recipe above to load its ingredients."
                          }
                        />
                      </>
                    )}
                  </CardSection>
                </React.Fragment>
              );
            })}

            {/* Pepperoni 1 */}
            <SectionHeader title="Pepperoni 1" />
            <CardSection>
              <SelectField
                label="Type"
                value={form.pep1Type}
                onChange={(v) => {
                  setForm((f) => ({ ...f, pep1Type: v }));
                  updateSettings({ pep1Type: v });
                }}
                options={pepTypes}
                onAddOption={(v) => addListItem("pepTypes", v)}
                onRemoveOption={(v) => removeListItem("pepTypes", v)}
                allowClear
                placeholder="Select or add a type…"
              />
              <NumericField
                label="Oz per Pizza"
                value={form.pep1OzPerPizza}
                onChangeText={set("pep1OzPerPizza")}
                onBlur={commitForm}
                placeholder="0.0"
                unit="oz"
              />
              <NumericField
                label="Sticks (flat buffer)"
                value={form.pep1Sticks}
                onChangeText={set("pep1Sticks")}
                onBlur={commitForm}
                placeholder="0"
                unit="sticks"
              />
              <NumericField
                label="Batch Weight"
                value={form.pep1BatchLbs}
                onChangeText={set("pep1BatchLbs")}
                onBlur={commitForm}
                placeholder="25"
                unit="lbs"
              />
            </CardSection>

            {/* Pepperoni 2 */}
            <SectionHeader title="Pepperoni 2" />
            <CardSection>
              <SelectField
                label="Type"
                value={form.pep2Type}
                onChange={(v) => {
                  setForm((f) => ({ ...f, pep2Type: v }));
                  updateSettings({ pep2Type: v });
                }}
                options={pepTypes}
                onAddOption={(v) => addListItem("pepTypes", v)}
                onRemoveOption={(v) => removeListItem("pepTypes", v)}
                allowClear
                placeholder="Select or add a type…"
              />
              <NumericField
                label="Oz per Pizza"
                value={form.pep2OzPerPizza}
                onChangeText={set("pep2OzPerPizza")}
                onBlur={commitForm}
                placeholder="0.0"
                unit="oz"
              />
              <NumericField
                label="Sticks (flat buffer)"
                value={form.pep2Sticks}
                onChangeText={set("pep2Sticks")}
                onBlur={commitForm}
                placeholder="0"
                unit="sticks"
              />
              <NumericField
                label="Batch Weight"
                value={form.pep2BatchLbs}
                onChangeText={set("pep2BatchLbs")}
                onBlur={commitForm}
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
                onBlur={commitForm}
                placeholder="0"
                unit="lbs"
              />
              <NumericField
                label="Doughball Weight"
                value={form.doughballWeightOz}
                onChangeText={set("doughballWeightOz")}
                onBlur={commitForm}
                placeholder="0.0"
                unit="oz"
              />
              <NumericField
                label="Doughballs per Tray"
                value={form.doughballsPerTray}
                onChangeText={set("doughballsPerTray")}
                onBlur={commitForm}
                placeholder="0"
              />
              <NumericField
                label="Crusts per Stack"
                value={form.crustsPerStack}
                onChangeText={set("crustsPerStack")}
                onBlur={commitForm}
                placeholder="0"
              />
              <NumericField
                label="Crusts per Case"
                value={form.crustsPerCase}
                onChangeText={set("crustsPerCase")}
                onBlur={commitForm}
                placeholder="0"
              />
              <NumericField
                label="Dough Batch Yield"
                value={form.doughBatchYield}
                onChangeText={set("doughBatchYield")}
                onBlur={commitForm}
                placeholder="0"
                unit="pizzas"
              />
            </CardSection>

            {/* Freezer */}
            <SectionHeader title="Freezer" />
            <CardSection>
              <NumericField
                label="Freezer Time"
                value={form.freezerTime}
                onChangeText={set("freezerTime")}
                onBlur={commitForm}
                placeholder="15"
                unit="min"
              />
            </CardSection>

            {/* Notes */}
            <SectionHeader title="Notes" />
            <CardSection>
              <TextField
                label="Notes"
                value={form.notes}
                onChangeText={set("notes")}
                onBlur={commitForm}
                placeholder="Any notes for this setup…"
              />
            </CardSection>

            <Pressable
              onPress={save}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.saveBtnText}>Save Setup</Text>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  intro: { fontSize: 13, lineHeight: 18, marginBottom: 12, fontFamily: FONTS.regular },
  pickLabel: {
    fontSize: 10,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
    fontFamily: FONTS.semibold,
  },
  pickEmpty: { fontSize: 13, fontStyle: "italic", fontFamily: FONTS.regular },

  computedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "space-between",
  },
  computedLabel: { fontSize: 16, fontWeight: "500" as const, fontFamily: FONTS.medium },
  computedValue: {
    fontSize: 22,
    fontWeight: "700" as const,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
  },

  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" as const, fontFamily: FONTS.bold },

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
  lockTitle: { fontSize: 20, fontWeight: "700" as const, marginTop: 4, fontFamily: FONTS.bold },
  lockHint: { fontSize: 13, textAlign: "center", marginBottom: 6, fontFamily: FONTS.regular },
  lockInput: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    letterSpacing: 4,
    fontFamily: FONTS.mono,
  },
  lockError: { color: "#ef4444", fontSize: 13, fontWeight: "500" as const, fontFamily: FONTS.medium },
  lockBtn: {
    width: "100%",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  lockBtnText: { fontSize: 16, fontWeight: "700" as const, fontFamily: FONTS.bold },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: "600" as const, fontFamily: FONTS.semibold },
  recipeHint: {
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
    fontStyle: "italic",
    fontFamily: FONTS.regular,
  },
  cheeseMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 16,
    rowGap: 4,
    marginTop: 8,
    marginBottom: 4,
  },
  cheeseMeta: { fontSize: 12, fontFamily: FONTS.regular },
  cheeseMetaVal: { fontFamily: FONTS.mono },
});
