import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ReadOnlyRecipe, StatRow } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useRun, computeCalc, sauceBarrelBreakdown } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

export default function SauceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run } = useRun();
  const calc = computeCalc(run, Date.now());

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const hasSauce = run.settings.sauceOzPerPizza > 0 && calc.sauceLbs > 0;
  const sauceBarrels = sauceBarrelBreakdown(calc.sauceLbs, calc.sauceEffBarrel);
  const sauceValue = sauceBarrels
    ? `${calc.sauceBatches.toFixed(2)} batches · ${sauceBarrels.totalBarrels} barrel${sauceBarrels.totalBarrels === 1 ? "" : "s"}`
    : `${calc.sauceBatches.toFixed(2)} batches`;

  const recipeName = run.settings.frontlineRecipeName?.trim();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
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
});
