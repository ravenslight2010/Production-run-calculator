import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, ReadOnlyRecipe, SectionHeader, StatRow } from "@/components/UI";
import {
  useRun,
  sauceBarrelBreakdown,
  DEFAULT_PEP_TYPES,
  type RecipeRow,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

export default function FrontlineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, calc } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const s = run.settings;

  const appStat = (n: 1 | 2 | 3 | 4, type: string, lbs: number, batches: number) => {
    const isMix = (type ?? "").trim().toLowerCase().includes("mix");
    return {
      label: type ? `App ${n} — ${type}` : `Applicator ${n}`,
      value: isMix ? `${lbs.toFixed(1)} lbs` : `${batches.toFixed(2)} batches`,
      highlight: isMix ? lbs > 0 : batches > 0,
    };
  };
  const pepStat = (n: 1 | 2, type: string, lbs: number, batches: number) => {
    const isDefault = DEFAULT_PEP_TYPES.includes(type ?? "");
    return {
      label: type ? `Pep ${n} — ${type}` : `Pep Applicator ${n}`,
      value: isDefault ? `${lbs.toFixed(2)} lbs` : `${batches.toFixed(2)} batches`,
      highlight: isDefault ? lbs > 0 : batches > 0,
    };
  };
  const apps = [
    appStat(1, s.app1Type, calc.app1Lbs, calc.app1Batches),
    appStat(2, s.app2Type, calc.app2Lbs, calc.app2Batches),
    appStat(3, s.app3Type, calc.app3Lbs, calc.app3Batches),
    appStat(4, s.app4Type, calc.app4Lbs, calc.app4Batches),
  ];
  const peps = [
    pepStat(1, s.pep1Type, calc.pep1Lbs, calc.pep1Batches),
    pepStat(2, s.pep2Type, calc.pep2Lbs, calc.pep2Batches),
  ];
  const sauceBd = sauceBarrelBreakdown(calc.sauceLbs, calc.sauceEffBarrel);
  const sauceValue = sauceBd
    ? `${calc.sauceBatches.toFixed(2)} batches · ${sauceBd.batchesPerBarrel}/barrel → ${sauceBd.totalBarrels} barrels`
    : `${calc.sauceBatches.toFixed(2)} batches`;

  const appRecipes = [
    { type: s.app1Type, recipe: s.app1CheeseRecipe, name: s.app1CheeseRecipeName },
    { type: s.app2Type, recipe: s.app2CheeseRecipe, name: s.app2CheeseRecipeName },
    { type: s.app3Type, recipe: s.app3CheeseRecipe, name: s.app3CheeseRecipeName },
    { type: s.app4Type, recipe: s.app4CheeseRecipe, name: s.app4CheeseRecipeName },
  ]
    .map((a) => {
      const t = (a.type ?? "").trim();
      const lower = t.toLowerCase();
      if (!t || (lower !== "cheese" && !lower.includes("mix"))) return null;
      const rows = (a.recipe ?? []).filter(
        (r) => (r.ingredient ?? "").trim() !== "" || (Number(r.lbs) || 0) > 0,
      );
      if (rows.length === 0) return null;
      return { type: t, name: a.name ?? "", rows: a.recipe ?? [] };
    })
    .filter(Boolean) as { type: string; name: string; rows: RecipeRow[] }[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Batches Needed" />
        <CardSection style={{ paddingVertical: 6 }}>
          <Text style={[styles.basis, { color: colors.mutedForeground }]}>
            Based on {Math.round(calc.casesLeft)} cases × {s.pizzasPerCase} pizzas/case
          </Text>
          <StatRow label="Sauce" value={sauceValue} highlight={calc.sauceBatches > 0} />
          {apps.map((a, i) => (
            <StatRow key={`app${i}`} label={a.label} value={a.value} highlight={a.highlight} />
          ))}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {peps.map((p, i) => (
            <StatRow key={`pep${i}`} label={p.label} value={p.value} highlight={p.highlight} />
          ))}
        </CardSection>

        {appRecipes.map((r, i) => (
          <View key={i} style={{ marginTop: 14 }}>
            <Text style={[styles.recipeTitle, { color: colors.foreground }]}>
              {r.type} Recipe
              {r.name?.trim() ? ` · ${r.name}` : ""}
            </Text>
            <CardSection style={{ paddingVertical: 14 }}>
              <ReadOnlyRecipe rows={r.rows} />
            </CardSection>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  basis: { fontSize: 12, marginTop: 6, marginBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, opacity: 0.5, marginVertical: 6 },
  recipeTitle: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
});
