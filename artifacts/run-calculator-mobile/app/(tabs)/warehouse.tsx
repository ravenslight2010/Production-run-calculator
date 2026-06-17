import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/UI";
import {
  useRun,
  computeCalc,
  todayStr,
  DEFAULT_PEP_TYPES,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";

function fmtNum(n: number, dec: number): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toFixed(dec);
}

function fmtDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type NeedRow = { label: string; value: string; sub: string };

export default function WarehouseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { allRuns, scheduled } = useRun();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  // Aggregate ingredient needs across active runs, preserving each row's native
  // unit (dough/sauce/cheese → batches, mixes/pepperoni → lbs) exactly like the
  // web warehouse tab (aggregateNeedRows). Never force everything to "lbs".
  const nowMs = Date.now();
  const map = new Map<string, { num: number; unit: string; order: number }>();
  let order = 0;
  const add = (label: string, num: number, unit: string) => {
    const key = `${label.trim()}__${unit}`;
    if (!label.trim() || num <= 0) return;
    const ex = map.get(key);
    if (ex) ex.num += num;
    else map.set(key, { num, unit, order: order++ });
  };
  for (const r of allRuns) {
    if (r.endedAt != null) continue;
    const c = computeCalc(r, nowMs);
    const s = r.settings;
    if (c.doughBatches > 0) add("Dough", c.doughBatches, "batches");
    if (c.sauceBatches > 0) add("Sauce", c.sauceBatches, "batches");
    const apps = [
      { type: s.app1Type, lbs: c.app1Lbs, batches: c.app1Batches },
      { type: s.app2Type, lbs: c.app2Lbs, batches: c.app2Batches },
      { type: s.app3Type, lbs: c.app3Lbs, batches: c.app3Batches },
      { type: s.app4Type, lbs: c.app4Lbs, batches: c.app4Batches },
    ];
    for (const a of apps) {
      if (!a.type) continue;
      const isMix = a.type.trim().toLowerCase().includes("mix");
      if (isMix && a.lbs > 0) add(a.type, a.lbs, "lbs");
      else if (!isMix && a.batches > 0) add(a.type, a.batches, "batches");
    }
    if (s.pep1Type && c.pep1Lbs > 0) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep1Type);
      if (isPepStd) add(s.pep1Type, c.pep1Lbs, "lbs");
      else add(s.pep1Type, c.pep1Batches, "batches");
    }
    if (s.pep2Type && c.pep2Lbs > 0) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep2Type);
      if (isPepStd) add(s.pep2Type, c.pep2Lbs, "lbs");
      else add(s.pep2Type, c.pep2Batches, "batches");
    }
  }
  const needRows: NeedRow[] = [...map.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, val]) => ({
      label: key.slice(0, key.lastIndexOf("__")),
      value: fmtNum(val.num, val.unit === "batches" ? 2 : 1),
      sub: val.unit,
    }));

  // Packaging consumables across active runs: circles are 1 per pizza
  // (casesNeeded × pizzasPerCase) and shippers are 1 per case (casesNeeded),
  // each grouped by the run's selected type. "none"/unset contribute nothing.
  // Mirrors web aggregatePackagingNeeds.
  const circleMap = new Map<string, number>();
  const shipperMap = new Map<string, number>();
  for (const r of allRuns) {
    if (r.endedAt != null) continue;
    const s = r.settings;
    const cases = s.casesNeeded;
    const pizzas = s.casesNeeded * s.pizzasPerCase;
    const circle = (s.circles ?? "").trim();
    if (circle && circle.toLowerCase() !== "none" && pizzas > 0) {
      circleMap.set(circle, (circleMap.get(circle) ?? 0) + pizzas);
    }
    const shipper = (s.shipper ?? "").trim();
    if (shipper && shipper.toLowerCase() !== "none" && cases > 0) {
      shipperMap.set(shipper, (shipperMap.get(shipper) ?? 0) + cases);
    }
  }
  const packagingRows: NeedRow[] = [];
  for (const [type, n] of circleMap)
    packagingRows.push({ label: `Circles — ${type}`, value: fmtNum(n, 0), sub: "circles" });
  for (const [type, n] of shipperMap)
    packagingRows.push({ label: `Shippers — ${type}`, value: fmtNum(n, 0), sub: "shippers" });

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
        {/* Total ingredient needs across all active runs (mixed units) */}
        <Card title="Total Ingredient Needs — All Runs" icon="archive">
          {needRows.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No data
            </Text>
          ) : (
            <View style={styles.needList}>
              {needRows.map((row, i) => (
                <View key={i} style={styles.needRow}>
                  <Text
                    style={[styles.needLabel, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {row.label}
                  </Text>
                  <Text style={styles.needValueWrap} numberOfLines={1}>
                    <Text style={[styles.needValue, { color: colors.foreground }]}>
                      {row.value}{" "}
                    </Text>
                    <Text style={[styles.needSub, { color: colors.mutedForeground }]}>
                      {row.sub}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Packaging consumables across all active runs */}
        {packagingRows.length > 0 && (
          <Card title="Packaging Needs — All Runs" icon="package" style={{ marginTop: 16 }}>
            <View style={styles.needList}>
              {packagingRows.map((row, i) => (
                <View key={i} style={styles.needRow}>
                  <Text
                    style={[styles.needLabel, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {row.label}
                  </Text>
                  <Text style={styles.needValueWrap} numberOfLines={1}>
                    <Text style={[styles.needValue, { color: colors.foreground }]}>
                      {row.value}{" "}
                    </Text>
                    <Text style={[styles.needSub, { color: colors.mutedForeground }]}>
                      {row.sub}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* Upcoming production schedule */}
        <Card title="Production Schedule" icon="calendar" style={{ marginTop: 16 }}>
          {scheduledDays.length === 0 ? (
            <Text style={[styles.empty, styles.emptyCenter, { color: colors.mutedForeground }]}>
              No upcoming days scheduled. Plan future production from the Schedule menu.
            </Text>
          ) : (
            <View style={styles.scheduleList}>
              {scheduledDays.map((d) => {
                const day = scheduled[d] ?? [];
                return (
                  <View
                    key={d}
                    style={[
                      styles.dayPill,
                      { backgroundColor: colors.secondary, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.dayLabel, { color: colors.foreground }]}>
                      {d === today ? "Today" : fmtDate(d)}
                    </Text>
                    <Text style={[styles.dayCount, { color: colors.mutedForeground }]}>
                      {day.length} run{day.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  empty: { fontSize: 13, fontStyle: "italic", fontFamily: FONTS.regular },
  emptyCenter: { textAlign: "center", paddingVertical: 6 },

  needList: { gap: 6 },
  needRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  needLabel: { fontSize: 14, flexShrink: 1, fontFamily: FONTS.regular },
  needValueWrap: { textAlign: "right", flexShrink: 0 },
  needValue: {
    fontSize: 14,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
  },
  needSub: { fontSize: 14, fontFamily: FONTS.regular },

  scheduleList: { gap: 6 },
  dayPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  dayLabel: { fontSize: 14, fontFamily: FONTS.medium },
  dayCount: { fontSize: 12, fontFamily: FONTS.regular },
});
