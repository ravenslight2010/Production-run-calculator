import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BatchCard, CardSection, SectionHeader } from "@/components/UI";
import { useRun, sauceBarrelBreakdown } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

export default function SauceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, calc } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const hasSauce = run.settings.sauceOzPerPizza > 0 && calc.sauceLbs > 0;
  const sauceBarrels = sauceBarrelBreakdown(calc.sauceLbs, calc.sauceEffBarrel);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Sauce Needs" />
        {hasSauce ? (
          <BatchCard
            name="Sauce"
            batches={calc.sauceBatches}
            lbs={calc.sauceLbs}
            sub={
              sauceBarrels
                ? `${sauceBarrels.totalBarrels} barrel${sauceBarrels.totalBarrels === 1 ? "" : "s"} · ${sauceBarrels.batchesPerBarrel}/barrel`
                : undefined
            }
          />
        ) : (
          <CardSection style={{ paddingVertical: 16 }}>
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              Set sauce oz per pizza in Setup to see sauce needs.
            </Text>
          </CardSection>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  empty: { fontSize: 13, fontStyle: "italic" },
});
