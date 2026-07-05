import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
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
import FillMissingPanel from "@/components/FillMissingPanel";
import {
  useRun,
  computeCalc,
  runLabel,
  PACKAGING_FIELDS,
  type RecipeRow,
  type RunSettings,
} from "@/context/RunContext";
import { computeCheesePull } from "@workspace/inventory-math";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useMixes } from "@/hooks/useMixes";
import { useCheeseRecipes } from "@/hooks/useCheeseRecipes";
import { useNamedRecipes } from "@/hooks/useNamedRecipes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { useMe } from "@/hooks/useRole";
import { findMixPresets } from "@/data/mixPresets";
import {
  allergenOptions,
  allergenSequenceWarnings,
  normalizeAllergen,
  type AllergenSequenceItem,
} from "@workspace/allergen";
import {
  evaluateRules,
  type RuleSequenceItem,
} from "@workspace/production-rules";
import { useProductionRules } from "@/hooks/useProductionRules";

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
  // Packaging
  cartonsPerCase: string;
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
    cartonsPerCase: n2s(s.cartonsPerCase),
  };
}

export default function ConfigureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    run,
    runIndex,
    allRuns,
    brandProfiles,
    updateSettings,
    templates,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
    dieTypes,
    pepTypes,
    addListItem,
    removeListItem,
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
  // Managers (server role) bypass the device PIN; operators still need it.
  const { isManager } = useMe();
  const [form, setForm] = useState<FormState>(() => settingsToForm(run.settings));
  // Clock-INDEPENDENT calc snapshot: recomputed only when `run` changes (not
  // per-second), so the cheese "pull for this run" breakdown reuses the same
  // applicator batch counts the run screen shows without subscribing to the
  // render clock (see render-clock-split). Batches depend on settings/progress,
  // not the wall clock, so a snapshot is exact for this purpose.
  const calc = useMemo(() => computeCalc(run, Date.now()), [run]);
  const appBatchesByN = [
    calc.app1Batches,
    calc.app2Batches,
    calc.app3Batches,
    calc.app4Batches,
  ];
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

  const currentAllergen = normalizeAllergen(run.settings.allergen);
  // Custom allergens (beyond egg/soy) used by saved profiles or other runs, so
  // an imported/new allergen stays selectable (and re-selectable) in the picker.
  const allergenChoices = allergenOptions([
    ...Object.values(brandProfiles).map((p) => p.allergen ?? "none"),
    ...allRuns.map((r) => r.settings.allergen),
    currentAllergen,
  ]);

  // Food-safety advisory: allergen transitions across the day's run sequence.
  const allergenWarnings = React.useMemo(() => {
    const seq: AllergenSequenceItem[] = allRuns.map((r, i) => ({
      id: r.id,
      label: `Run ${i + 1} · ${runLabel(r, i)}`,
      allergen: normalizeAllergen(r.settings.allergen),
    }));
    return allergenSequenceWarnings(seq);
  }, [allRuns]);

  // Manager-defined production rules (factory-wide, server-persisted). Evaluated
  // against the current run + the day's sequence. "flexible" rules warn inline
  // (alongside the allergen advisory); "strict" rules block starting the run.
  const { rules: productionRules } = useProductionRules();
  const { items: serverMixes } = useMixes();
  // Factory-wide cheese recipes (server master-data). The applicator "Cheese"
  // cards pick one of these by name and hydrate their rows read-only from it —
  // cheese is deliberately NOT routed through Mixes.
  const { items: cheeseRecipesList } = useCheeseRecipes();
  // Factory-wide dough / sauce recipes (server master-data). The applicator
  // "Dough" / "Sauce" cards pick one of these by name and hydrate their rows
  // from it. Mirrors cheese; dough & sauce each have their OWN server pool.
  const { items: doughRecipesList } = useNamedRecipes("dough");
  const { items: sauceRecipesList } = useNamedRecipes("sauce");
  const ruleViolations = React.useMemo(() => {
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
      runLabel: runLabel(run, allRuns.findIndex((r) => r.id === run.id)),
      sequence: seq,
      currentRunId: run.id,
    });
  }, [productionRules, allRuns, run]);

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
      cartonsPerCase: toNum(form.cartonsPerCase),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // Recipe editors write directly to run settings (no string-form intermediary)
  const cheeseNames = Object.keys(cheeseRecipePresets);
  const doughNames = Object.keys(doughRecipePresets);
  const frontlineNames = Object.keys(frontlineRecipePresets);

  // Imported mixes (server Mixes master data, from premix sheet imports / the
  // Mixes manager) → recipe rows. Server Mixes is the single source for mix
  // recipes across the app (web + mobile parity); the separate "Mix" recipe-type
  // lists and locally-saved mixes were merged into Mixes.
  const serverMixPresets = serverMixes
    .map((m) => ({
      name: m.name,
      ingredients: (m.components ?? [])
        .filter((c) => c.ingredient.trim())
        .map((c) => ({ ingredient: c.ingredient, lbs: c.perPizza })),
    }))
    .filter((p) => p.ingredients.length > 0);

  // ── Cheese pick-only support (mirrors web home.tsx). A picked cheese-recipe
  // NAME hydrates the applicator rows read-only from the server pool, and lets
  // us surface the recipe's shredder setting / cellulose note. ──
  const enabledCheeseRecipes = React.useMemo(
    () => cheeseRecipesList.filter((r) => r.enabled !== false),
    [cheeseRecipesList],
  );
  // Name (case-insensitive) → full recipe, so a picked name can show its
  // shredder setting / assigned flavors.
  const serverCheeseByName = React.useMemo(() => {
    const map = new Map<string, CheeseRecipe>();
    for (const r of enabledCheeseRecipes) {
      const key = r.name.trim().toLowerCase();
      if (key) map.set(key, r);
    }
    return map;
  }, [enabledCheeseRecipes]);
  // Recipe rows ({ ingredient, lbs }) for a picked cheese recipe — a straight
  // copy of its components (already the per-batch-lbs RecipeRow shape).
  const serverCheeseRowsByName = React.useMemo(() => {
    const map = new Map<string, RecipeRow[]>();
    for (const r of enabledCheeseRecipes) {
      const rows = r.components
        .filter((c) => c.ingredient.trim())
        .map((c) => ({ ingredient: c.ingredient, lbs: c.lbs }));
      const key = r.name.trim().toLowerCase();
      if (key) map.set(key, rows);
    }
    return map;
  }, [enabledCheeseRecipes]);
  const serverCheeseNames = React.useMemo(
    () =>
      [
        ...new Set(enabledCheeseRecipes.map((r) => r.name.trim()).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b)),
    [enabledCheeseRecipes],
  );
  // Names filtered to the current run's brand/flavor: prefer recipes for this
  // customer (brand) and — among those — ones assigned to this flavor (or "all
  // varieties", i.e. no flavors). Returns ALL names when nothing matches so the
  // operator is never stuck without a choice. Verbatim mirror of web.
  const cheeseNamesForRun = React.useMemo(() => {
    return (brand: string, flavor: string): string[] => {
      const b = brand.trim().toLowerCase();
      const f = flavor.trim().toLowerCase();
      if (!b) return serverCheeseNames;
      const brandMatches = enabledCheeseRecipes.filter(
        (r) => r.brand.trim().toLowerCase() === b,
      );
      if (brandMatches.length === 0) return serverCheeseNames;
      const flavorMatches = f
        ? brandMatches.filter(
            (r) =>
              r.flavors.length === 0 ||
              r.flavors.some((x) => x.trim().toLowerCase() === f),
          )
        : brandMatches;
      const pool = flavorMatches.length > 0 ? flavorMatches : brandMatches;
      return [
        ...new Set(pool.map((r) => r.name.trim()).filter(Boolean)),
      ].sort((x, y) => x.localeCompare(y));
    };
  }, [enabledCheeseRecipes, serverCheeseNames]);

  // ── Dough / Sauce server-pool support (mirrors web home.tsx + the cheese
  // pattern above). A picked recipe NAME hydrates the applicator rows from the
  // server pool; the run-form chips union the server names with any locally
  // known preset names (backward compat for names still only in the synced
  // list). ──
  const serverDoughRowsByName = React.useMemo(() => {
    const map = new Map<string, RecipeRow[]>();
    for (const r of doughRecipesList) {
      if (r.enabled === false) continue;
      const rows = r.components
        .filter((c) => c.ingredient.trim())
        .map((c) => ({ ingredient: c.ingredient, lbs: c.lbs }));
      const key = r.name.trim().toLowerCase();
      if (key) map.set(key, rows);
    }
    return map;
  }, [doughRecipesList]);
  const serverSauceRowsByName = React.useMemo(() => {
    const map = new Map<string, RecipeRow[]>();
    for (const r of sauceRecipesList) {
      if (r.enabled === false) continue;
      const rows = r.components
        .filter((c) => c.ingredient.trim())
        .map((c) => ({ ingredient: c.ingredient, lbs: c.lbs }));
      const key = r.name.trim().toLowerCase();
      if (key) map.set(key, rows);
    }
    return map;
  }, [sauceRecipesList]);
  const serverDoughNames = React.useMemo(
    () => [
      ...new Set(
        doughRecipesList
          .filter((r) => r.enabled !== false)
          .map((r) => r.name.trim())
          .filter(Boolean),
      ),
    ],
    [doughRecipesList],
  );
  const serverSauceNames = React.useMemo(
    () => [
      ...new Set(
        sauceRecipesList
          .filter((r) => r.enabled !== false)
          .map((r) => r.name.trim())
          .filter(Boolean),
      ),
    ],
    [sauceRecipesList],
  );
  const doughRecipeNameOptions = React.useMemo(
    () =>
      [...new Set([...serverDoughNames, ...doughNames].map((n) => n.trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [serverDoughNames, doughNames],
  );
  const frontlineRecipeNameOptions = React.useMemo(
    () =>
      [...new Set([...serverSauceNames, ...frontlineNames].map((n) => n.trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [serverSauceNames, frontlineNames],
  );

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

  if (supervisorPin && !unlocked && !isManager) {
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

        {/* Fill in missing data assistant */}
        <FillMissingPanel />

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

        {/* Packaging Settings */}
        <SectionHeader title="Packaging Settings" />
        {PACKAGING_FIELDS.map((f) => {
          const cur = (run.settings[f.name] as string) ?? "";
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
            onBlur={save}
            placeholder="0"
          />
        </CardSection>

        {/* Die Type */}
        <SectionHeader title="Die Type" />
        <CardSection style={{ paddingVertical: 12 }}>
          <SelectField
            value={form.dieType}
            onChange={(v) => {
              setForm((f) => ({ ...f, dieType: v }));
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
          {allergenWarnings.length > 0 && (
            <View style={{ marginTop: 10, gap: 8 }}>
              {allergenWarnings.map((w) => {
                const danger = w.kind === "clean-not-advisable";
                return (
                  <View
                    key={`${w.fromId}-${w.toId}`}
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      padding: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: danger ? "#dc2626" : "#d97706",
                      backgroundColor: danger ? "#dc262622" : "#d9770622",
                    }}
                  >
                    <Feather
                      name="alert-triangle"
                      size={14}
                      color={danger ? "#fca5a5" : "#fcd34d"}
                      style={{ marginTop: 2 }}
                    />
                    <Text
                      style={{
                        flex: 1,
                        fontFamily: FONTS.regular,
                        fontSize: 12,
                        color: danger ? "#fca5a5" : "#fcd34d",
                      }}
                    >
                      <Text style={{ fontFamily: FONTS.bold }}>
                        {w.fromLabel} → {w.toLabel}:{" "}
                      </Text>
                      {w.message}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
          {ruleViolations.length > 0 && (
            <View style={{ marginTop: 10, gap: 8 }}>
              {ruleViolations.map((rv) => {
                const danger = rv.enforcement === "strict";
                return (
                  <View
                    key={rv.ruleId}
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      padding: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: danger ? "#dc2626" : "#d97706",
                      backgroundColor: danger ? "#dc262622" : "#d9770622",
                    }}
                  >
                    <Feather
                      name="alert-triangle"
                      size={14}
                      color={danger ? "#fca5a5" : "#fcd34d"}
                      style={{ marginTop: 2 }}
                    />
                    <Text
                      style={{
                        flex: 1,
                        fontFamily: FONTS.regular,
                        fontSize: 12,
                        color: danger ? "#fca5a5" : "#fcd34d",
                      }}
                    >
                      <Text style={{ fontFamily: FONTS.bold }}>
                        {rv.name}
                        {danger ? " (blocks start)" : ""}:{" "}
                      </Text>
                      {rv.message}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
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

        {/* Dough Recipe */}
        <SectionHeader title="Dough Recipe" />
        <CardSection>
          <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
            Dough recipe (overrides batch weight when set)
          </Text>
          <RecipeEditor
            rows={run.settings.doughRecipe}
            onChange={(rows) => updateSettings({ doughRecipe: rows })}
            ingredientOptions={doughIngredients}
            onAddIngredient={(v) => addListItem("doughIngredients", v)}
            onRemoveIngredient={(v) => removeListItem("doughIngredients", v)}
            name={run.settings.doughRecipeName}
            onNameChange={(n) => updateSettings({ doughRecipeName: n })}
            presetNames={doughRecipeNameOptions}
            onSavePreset={() =>
              saveRecipePreset(
                "dough",
                run.settings.doughRecipeName,
                run.settings.doughRecipe,
              )
            }
            onApplyPreset={(presetName) => {
              // Prefer the server pool; fall back to a locally-saved preset for
              // names that only exist in the synced list (backward compat).
              const rows =
                serverDoughRowsByName.get(presetName.trim().toLowerCase()) ??
                doughRecipePresets[presetName];
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
            onAddIngredient={(v) => addListItem("frontlineIngredients", v)}
            onRemoveIngredient={(v) => removeListItem("frontlineIngredients", v)}
            name={run.settings.frontlineRecipeName}
            onNameChange={(n) => updateSettings({ frontlineRecipeName: n })}
            presetNames={frontlineRecipeNameOptions}
            onSavePreset={() =>
              saveRecipePreset(
                "frontline",
                run.settings.frontlineRecipeName,
                run.settings.frontlineRecipe,
              )
            }
            onApplyPreset={(presetName) => {
              // Prefer the server pool; fall back to a locally-saved preset for
              // names that only exist in the synced list (backward compat).
              const rows =
                serverSauceRowsByName.get(presetName.trim().toLowerCase()) ??
                frontlineRecipePresets[presetName];
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
          // A "mix" applicator keeps the editable RecipeEditor (mixes still edit
          // freely); anything else is a cheese blend that PICKS from the server
          // cheese pool. Default (blank type) is treated as cheese.
          const isMixApplicator = (form[typeKey] as string)
            .toLowerCase()
            .includes("mix");
          const pickedCheese = recipeName.trim()
            ? serverCheeseByName.get(recipeName.trim().toLowerCase())
            : undefined;
          // A picked name that resolves to nothing in the server cheese pool
          // (e.g. a spec sheet referenced a blend that was never imported).
          // Drives an inline "pick a real blend" warning instead of a silent,
          // confusing blank body. Mirrors web CheesePickCard `recipeMissing`.
          const cheeseMissing = recipeName.trim() !== "" && !pickedCheese;
          // Options scoped to this run's brand/flavor, but always include the
          // currently-picked name so a recipe assigned elsewhere (or since
          // disabled) still shows instead of silently clearing.
          const scopedCheeseNames = cheeseNamesForRun(
            run.settings.brand ?? "",
            run.settings.flavor ?? "",
          );
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
                {isMixApplicator ? (
                  <>
                    <Text style={[styles.recipeHint, { color: colors.mutedForeground }]}>
                      Recipe (overrides batch weight when set)
                    </Text>
                    <RecipeEditor
                      rows={rows}
                      unit="oz"
                      onChange={(r) =>
                        updateSettings({ [recipeKey]: r } as Partial<RunSettings>)
                      }
                      ingredientOptions={cheeseIngredients}
                      onAddIngredient={(v) => addListItem("cheeseIngredients", v)}
                      onRemoveIngredient={(v) => removeListItem("cheeseIngredients", v)}
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
                    {pickedCheese &&
                    (pickedCheese.shredderSetting.trim() ||
                      pickedCheese.cellulose.trim()) ? (
                      <View style={styles.cheeseMetaRow}>
                        {pickedCheese.shredderSetting.trim() ? (
                          <Text
                            style={[
                              styles.cheeseMeta,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            Shredder setting:{" "}
                            <Text
                              style={[styles.cheeseMetaVal, { color: colors.foreground }]}
                            >
                              {pickedCheese.shredderSetting}
                            </Text>
                          </Text>
                        ) : null}
                        {pickedCheese.cellulose.trim() ? (
                          <Text
                            style={[
                              styles.cheeseMeta,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            Cellulose:{" "}
                            <Text
                              style={[styles.cheeseMetaVal, { color: colors.foreground }]}
                            >
                              {pickedCheese.cellulose}
                            </Text>
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {cheeseMissing ? (
                      <View
                        style={[
                          styles.cheeseWarn,
                          {
                            borderColor: colors.warning,
                            backgroundColor: colors.warning + "22",
                          },
                        ]}
                      >
                        <Text style={[styles.cheeseWarnText, { color: colors.warning }]}>
                          {`No matching cheese recipe found for “${recipeName.trim()}”. Pick a real blend from the dropdown above, or a manager can add it under Manage Lists → Cheese Recipes.`}
                        </Text>
                      </View>
                    ) : (
                      <ReadOnlyRecipe
                        rows={rows}
                        ozPerPizza={Number(form[ozKey]) || 0}
                        emptyText={
                          recipeName.trim()
                            ? "This cheese recipe has no ingredients yet. A manager can edit it under Manage Lists → Cheese Recipes."
                            : "Pick a cheese recipe above to load its ingredients."
                        }
                      />
                    )}
                    {(() => {
                      // Pounds of each cheese to pull/mix for this run: the blend
                      // recipe's per-batch pounds scaled by this applicator's batch
                      // count. Shared pure helper so numbers match the web card and
                      // never drift from the batch/total figures.
                      const batches = appBatchesByN[n - 1];
                      const pull = computeCheesePull(rows, batches);
                      const pullRows = pull.rows.filter(
                        (r) => r.ingredient.trim() !== "" || r.lbs > 0,
                      );
                      if (pullRows.length === 0) return null;
                      return (
                        <View style={styles.pullBlock}>
                          <Text
                            style={[styles.pullTitle, { color: colors.mutedForeground }]}
                          >
                            PULL FOR THIS RUN
                            {batches > 0 ? ` · ≈ ${batches.toFixed(2)} batches` : ""}
                          </Text>
                          {pullRows.map((r, i) => (
                            <View
                              key={i}
                              style={[styles.pullRow, { borderBottomColor: colors.border }]}
                            >
                              <Text
                                style={[styles.pullIng, { color: colors.foreground }]}
                                numberOfLines={1}
                              >
                                {r.ingredient || "—"}
                              </Text>
                              <Text style={[styles.pullLbs, { color: colors.foreground }]}>
                                {r.lbs.toFixed(1)} lbs
                              </Text>
                            </View>
                          ))}
                          <View style={styles.pullTotalRow}>
                            <Text
                              style={[styles.pullTotalLabel, { color: colors.mutedForeground }]}
                            >
                              Total
                            </Text>
                            <Text
                              style={[styles.pullTotalVal, { color: colors.foreground }]}
                            >
                              {pull.totalLbs.toFixed(1)} lbs
                            </Text>
                          </View>
                        </View>
                      );
                    })()}
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
  runHeaderLabel: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 1, fontFamily: FONTS.semibold },
  runHeaderName: { fontSize: 17, fontWeight: "700" as const, fontFamily: FONTS.bold },

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
  resetBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  resetBtnText: { fontSize: 16, fontWeight: "600" as const, fontFamily: FONTS.semibold },

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
  masterDataText: { flex: 1, fontSize: 15, fontWeight: "600" as const, fontFamily: FONTS.semibold },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  cheeseMeta: {
    fontSize: 12,
    fontFamily: FONTS.regular,
  },
  cheeseWarn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  cheeseWarnText: {
    fontSize: 12,
    fontFamily: FONTS.regular,
  },
  cheeseMetaVal: {
    fontFamily: FONTS.mono,
  },
  pullBlock: {
    marginTop: 12,
  },
  pullTitle: {
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: 6,
    fontFamily: FONTS.semibold,
  },
  pullRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pullIng: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.regular,
    marginRight: 8,
  },
  pullLbs: {
    fontSize: 14,
    fontFamily: FONTS.mono,
  },
  pullTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  pullTotalLabel: {
    fontSize: 12,
    fontFamily: FONTS.semibold,
  },
  pullTotalVal: {
    fontSize: 14,
    fontFamily: FONTS.semibold,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: "600" as const, fontFamily: FONTS.semibold },

  tplEmpty: { fontSize: 13, lineHeight: 18, marginBottom: 12, fontFamily: FONTS.regular },
  tplRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tplName: { fontSize: 15, fontWeight: "600" as const, fontFamily: FONTS.semibold },
  tplMeta: { fontSize: 12, marginTop: 1, fontFamily: FONTS.regular },
  tplApply: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tplApplyText: { color: "#000", fontSize: 13, fontWeight: "700" as const, fontFamily: FONTS.bold },
  tplDelete: { padding: 4 },
  tplSaveRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tplInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "web" ? 8 : 10,
    fontSize: 15,
    fontFamily: FONTS.regular,
  },
  tplSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  tplSaveBtnText: { color: "#000", fontSize: 13, fontWeight: "700" as const, fontFamily: FONTS.bold },
});
