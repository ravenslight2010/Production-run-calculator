import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, SectionHeader } from "@/components/UI";
import { useRun, computeCalc, todayStr } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";

function fmtDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function WarehouseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { allRuns, scheduled } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  // Aggregate ingredient lbs across runs that haven't finished yet, reusing the
  // same per-run material math as the individual station tabs.
  const nowMs = Date.now();
  const totals: Record<string, number> = {};
  const add = (name: string, lbs: number) => {
    const key = name.trim();
    if (!key || lbs <= 0) return;
    totals[key] = (totals[key] ?? 0) + lbs;
  };
  let activeRunCount = 0;
  for (const r of allRuns) {
    if (r.endedAt != null) continue;
    activeRunCount += 1;
    const c = computeCalc(r, nowMs);
    const s = r.settings;
    if (s.sauceOzPerPizza > 0) add("Sauce", c.sauceLbs);
    add(s.app1Type, c.app1Lbs);
    add(s.app2Type, c.app2Lbs);
    add(s.app3Type, c.app3Lbs);
    add(s.app4Type, c.app4Lbs);
    add(s.pep1Type, c.pep1Lbs);
    add(s.pep2Type, c.pep2Lbs);
    if (s.doughBatchLbs > 0) add("Dough", c.doughLbs);
  }
  const ingredientRows = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  const today = todayStr();
  const scheduledDays = Object.keys(scheduled)
    .filter((d) => (scheduled[d]?.length ?? 0) > 0 && d >= today)
    .sort();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Aggregated ingredient needs */}
        <SectionHeader title="Ingredient Needs" />
        <CardSection style={{ paddingVertical: 6 }}>
          {ingredientRows.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No active runs to stage. Configure today&apos;s runs to see totals.
            </Text>
          ) : (
            ingredientRows.map(([name, lbs]) => (
              <View key={name} style={[styles.ingRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.ingName, { color: colors.foreground }]} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={[styles.ingValue, { color: colors.primary }]}>
                  {lbs.toFixed(0)} lbs
                </Text>
              </View>
            ))
          )}
        </CardSection>
        {activeRunCount > 0 ? (
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Totals across {activeRunCount} active run{activeRunCount !== 1 ? "s" : ""} in today&apos;s lineup.
          </Text>
        ) : null}

        {/* Production schedule overview */}
        <SectionHeader title="Production Schedule" />
        <CardSection style={{ paddingVertical: 6 }}>
          {scheduledDays.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No upcoming days planned yet.
            </Text>
          ) : (
            scheduledDays.map((d) => {
              const day = scheduled[d] ?? [];
              return (
                <View key={d} style={[styles.dayBlock, { borderBottomColor: colors.border }]}>
                  <View style={styles.dayHeader}>
                    <Text style={[styles.dayTitle, { color: colors.foreground }]}>
                      {d === today ? "Today" : fmtDate(d)}
                    </Text>
                    <Text style={[styles.dayCount, { color: colors.mutedForeground }]}>
                      {day.length} run{day.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  {day.map((r) => (
                    <Text key={r.id} style={[styles.dayRun, { color: colors.mutedForeground }]}>
                      • {r.brand} · {r.flavor}
                      {r.casesNeeded > 0 ? ` — ${r.casesNeeded} cases` : ""}
                    </Text>
                  ))}
                </View>
              );
            })
          )}
        </CardSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  empty: { fontSize: 13, fontStyle: "italic", paddingVertical: 10 },
  hint: { fontSize: 12, marginTop: 10 },

  ingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ingName: { fontSize: 16, fontWeight: "500" as const, flex: 1, marginRight: 12 },
  ingValue: { fontSize: 18, fontWeight: "700" as const },

  dayBlock: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayTitle: { fontSize: 15, fontWeight: "700" as const },
  dayCount: { fontSize: 12 },
  dayRun: { fontSize: 13, marginTop: 2 },
});
