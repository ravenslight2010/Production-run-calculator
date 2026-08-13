import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ReadOnlyRecipe, StatRow } from "@/components/UI";
import { FONTS } from "@/constants/fonts";
import { useRun, computeCalc, sauceBarrelBreakdown } from "@/context/RunContext";
import RecipeSubstitutionBadge from "@/components/RecipeSubstitutionBadge";
import { useColors } from "@/hooks/useColors";

export default function SauceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, substitutions, prepPhase, startPrep, addPrepBatchSauce } = useRun();
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
