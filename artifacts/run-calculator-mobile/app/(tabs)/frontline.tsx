import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ReadOnlyRecipe, StatRow } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import {
  useRun,
  computeCalc,
  sauceBarrelBreakdown,
  DEFAULT_PEP_TYPES,
  type RecipeRow,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

function RecipeCard({
  type,
  name,
  rows,
  isMix,
}: {
  type: string;
  name: string;
  rows: RecipeRow[];
  isMix: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.recipeCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.recipeAccent,
          { backgroundColor: isMix ? "#10b981" : colors.warning },
        ]}
      />
      <View style={styles.recipeHeader}>
        <Feather name="clipboard" size={15} color={colors.mutedForeground} />
        <Text
          style={[styles.recipeTitle, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {`${type} Recipe`.toUpperCase()}
        </Text>
        {name?.trim() ? (
          <Text
            style={[styles.recipeSubtitle, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {name}
          </Text>
        ) : null}
      </View>
      <View style={styles.recipeContent}>
        <ReadOnlyRecipe rows={rows} />
      </View>
    </View>
  );
}

export default function FrontlineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run } = useRun();
  const calc = computeCalc(run, Date.now());

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
      return {
        type: t,
        name: a.name ?? "",
        rows: a.recipe ?? [],
        isMix: lower.includes("mix"),
      };
    })
    .filter(Boolean) as { type: string; name: string; rows: RecipeRow[]; isMix: boolean }[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Card title="Batches Needed" icon="box" accent>
          <Text style={[styles.basis, { color: colors.mutedForeground }]}>
            Based on{" "}
            <Text style={[styles.basisNum, { color: colors.foreground }]}>
              {Math.round(calc.casesLeftToRun)}
            </Text>{" "}
            cases ×{" "}
            <Text style={[styles.basisNum, { color: colors.foreground }]}>
              {s.pizzasPerCase}
            </Text>{" "}
            pizzas/case
          </Text>
          <StatRow label="Sauce" value={sauceValue} highlight={calc.sauceBatches > 0} />
          {apps.map((a, i) => (
            <StatRow key={`app${i}`} label={a.label} value={a.value} highlight={a.highlight} />
          ))}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {peps.map((p, i) => (
            <StatRow key={`pep${i}`} label={p.label} value={p.value} highlight={p.highlight} />
          ))}
        </Card>

        {appRecipes.map((r, i) => (
          <View key={i} style={{ marginTop: 16 }}>
            <RecipeCard type={r.type} name={r.name} rows={r.rows} isMix={r.isMix} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  basis: { fontSize: 12, marginBottom: 8, fontFamily: FONTS.regular },
  basisNum: { fontFamily: FONTS.mono },
  divider: { height: StyleSheet.hairlineWidth, opacity: 0.5, marginVertical: 6 },
  recipeCard: { borderRadius: 8, borderWidth: 1, overflow: "hidden" },
  recipeAccent: { height: 3, width: "100%" },
  recipeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
  },
  recipeTitle: {
    fontSize: 12,
    fontFamily: FONTS.semibold,
    letterSpacing: 1,
    flexShrink: 1,
  },
  recipeSubtitle: {
    fontSize: 12,
    fontFamily: FONTS.mono,
    marginLeft: "auto",
    maxWidth: "50%",
    textAlign: "right",
  },
  recipeContent: { paddingHorizontal: 16, paddingVertical: 12 },
});
