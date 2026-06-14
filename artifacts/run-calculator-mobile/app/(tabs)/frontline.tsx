import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BatchCard, CardSection, SectionHeader } from "@/components/UI";
import { useRun } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

export default function FrontlineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, calc } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const s = run.settings;
  const batches = [
    s.app1Type ? { name: s.app1Type, batches: calc.app1Batches, lbs: calc.app1Lbs } : null,
    s.app2Type ? { name: s.app2Type, batches: calc.app2Batches, lbs: calc.app2Lbs } : null,
    s.app3Type ? { name: s.app3Type, batches: calc.app3Batches, lbs: calc.app3Lbs } : null,
    s.app4Type ? { name: s.app4Type, batches: calc.app4Batches, lbs: calc.app4Lbs } : null,
    s.pep1Type ? { name: s.pep1Type, batches: calc.pep1Batches, lbs: calc.pep1Lbs } : null,
    s.pep2Type ? { name: s.pep2Type, batches: calc.pep2Batches, lbs: calc.pep2Lbs } : null,
  ].filter(Boolean) as { name: string; batches: number; lbs: number }[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Frontline Needs" />
        {batches.length > 0 ? (
          <View style={styles.batchGrid}>
            {batches.map((b) => (
              <BatchCard
                key={b.name}
                name={b.name}
                batches={b.batches}
                lbs={b.lbs}
                style={styles.batchItem}
              />
            ))}
          </View>
        ) : (
          <CardSection style={{ paddingVertical: 16 }}>
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              Add applicator or pepperoni types in Setup to see frontline needs.
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
  batchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  batchItem: { flexBasis: "47%", flexGrow: 1 },
  empty: { fontSize: 13, fontStyle: "italic" },
});
