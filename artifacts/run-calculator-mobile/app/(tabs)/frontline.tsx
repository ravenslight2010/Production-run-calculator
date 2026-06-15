import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BatchCard, CardSection, SectionHeader } from "@/components/UI";
import { useRun, sauceBarrelBreakdown } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

export default function FrontlineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { run, calc } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const s = run.settings;
  const applicators = [
    s.app1Type ? { name: s.app1Type, batches: calc.app1Batches, lbs: calc.app1Lbs } : null,
    s.app2Type ? { name: s.app2Type, batches: calc.app2Batches, lbs: calc.app2Lbs } : null,
    s.app3Type ? { name: s.app3Type, batches: calc.app3Batches, lbs: calc.app3Lbs } : null,
    s.app4Type ? { name: s.app4Type, batches: calc.app4Batches, lbs: calc.app4Lbs } : null,
  ].filter(Boolean) as { name: string; batches: number; lbs: number }[];
  const pepperoni = [
    s.pep1Type ? { name: s.pep1Type, batches: calc.pep1Batches, lbs: calc.pep1Lbs } : null,
    s.pep2Type ? { name: s.pep2Type, batches: calc.pep2Batches, lbs: calc.pep2Lbs } : null,
  ].filter(Boolean) as { name: string; batches: number; lbs: number }[];

  const hasSauce = s.sauceOzPerPizza > 0 && calc.sauceLbs > 0;
  const sauceBarrels = sauceBarrelBreakdown(calc.sauceLbs, calc.sauceEffBarrel);

  const hasAny = hasSauce || applicators.length > 0 || pepperoni.length > 0;

  const renderGrid = (rows: { name: string; batches: number; lbs: number }[]) => (
    <View style={styles.batchGrid}>
      {rows.map((b) => (
        <BatchCard
          key={b.name}
          name={b.name}
          batches={b.batches}
          lbs={b.lbs}
          style={styles.batchItem}
        />
      ))}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {hasAny ? (
          <>
            <SectionHeader title="Batches Needed" />
            <Text style={[styles.basis, { color: colors.mutedForeground }]}>
              Based on {Math.round(calc.casesLeft)} cases × {s.pizzasPerCase} pizzas/case
            </Text>
            {hasSauce ? (
              <>
                <SectionHeader title="Sauce" />
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
              </>
            ) : null}
            {applicators.length > 0 ? (
              <>
                <SectionHeader title="Applicators" />
                {renderGrid(applicators)}
              </>
            ) : null}
            {pepperoni.length > 0 ? (
              <>
                <SectionHeader title="Pepperoni" />
                {renderGrid(pepperoni)}
              </>
            ) : null}
          </>
        ) : (
          <>
            <SectionHeader title="Frontline Needs" />
            <CardSection style={{ paddingVertical: 16 }}>
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                Add applicator or pepperoni types in Setup to see frontline needs.
              </Text>
            </CardSection>
          </>
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
  basis: { fontSize: 12, marginBottom: 4 },
  empty: { fontSize: 13, fontStyle: "italic" },
});
