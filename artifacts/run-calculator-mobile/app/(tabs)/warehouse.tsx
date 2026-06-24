import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/UI";
import {
  useRun,
  computeCalc,
  runLabel,
  todayStr,
  profileKey,
  DEFAULT_SETTINGS,
  DEFAULT_PROGRESS,
  DEFAULT_PEP_TYPES,
  type RunCalc,
  type RunSettings,
  type RunState,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { useFreezerPullItems } from "@/hooks/useFreezerPullItems";
import { buildFreezerPullPlan } from "@workspace/freezer-pull";
import ReorderCard from "@/components/ReorderCard";
import UseFirstCard from "@/components/UseFirstCard";

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

function fmtDur(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Build the ingredient + packaging need rows for a SINGLE run, preserving each
// row's native unit. Mirrors the all-runs aggregation below (and the web
// aggregateNeedRows/aggregatePackagingNeeds) so the per-run breakdown lines up
// exactly with the totals.
function buildRunNeedRows(c: RunCalc, s: RunSettings): NeedRow[] {
  const rows: NeedRow[] = [];
  const fmt = (n: number, unit: string): string =>
    fmtNum(n, unit === "batches" ? 2 : 1);
  if (c.doughBatches > 0) rows.push({ label: "Dough", value: fmt(c.doughBatches, "batches"), sub: "batches" });
  if (c.sauceBatches > 0) rows.push({ label: "Sauce", value: fmt(c.sauceBatches, "batches"), sub: "batches" });
  const apps = [
    { type: s.app1Type, lbs: c.app1Lbs, batches: c.app1Batches },
    { type: s.app2Type, lbs: c.app2Lbs, batches: c.app2Batches },
    { type: s.app3Type, lbs: c.app3Lbs, batches: c.app3Batches },
    { type: s.app4Type, lbs: c.app4Lbs, batches: c.app4Batches },
  ];
  for (const a of apps) {
    if (!a.type) continue;
    const isMix = a.type.trim().toLowerCase().includes("mix");
    if (isMix && a.lbs > 0) rows.push({ label: a.type, value: fmt(a.lbs, "lbs"), sub: "lbs" });
    else if (!isMix && a.batches > 0) rows.push({ label: a.type, value: fmt(a.batches, "batches"), sub: "batches" });
  }
  const peps = [
    { type: s.pep1Type, lbs: c.pep1Lbs, batches: c.pep1Batches },
    { type: s.pep2Type, lbs: c.pep2Lbs, batches: c.pep2Batches },
  ];
  for (const p of peps) {
    if (!p.type || p.lbs <= 0) continue;
    if (DEFAULT_PEP_TYPES.includes(p.type)) rows.push({ label: p.type, value: fmt(p.lbs, "lbs"), sub: "lbs" });
    else rows.push({ label: p.type, value: fmt(p.batches, "batches"), sub: "batches" });
  }
  return rows;
}

// Packaging consumables for a SINGLE cartoned run (mirrors the all-runs roll-up).
function buildRunPackagingRows(s: RunSettings): NeedRow[] {
  const rows: NeedRow[] = [];
  if ((s.cartoned ?? "").trim().toLowerCase() !== "yes") return rows;
  const cases = s.casesNeeded;
  const pizzas = s.casesNeeded * s.pizzasPerCase;
  const circle = (s.circles ?? "").trim();
  if (circle && circle.toLowerCase() !== "none" && pizzas > 0)
    rows.push({ label: `Circles — ${circle}`, value: fmtNum(pizzas, 0), sub: "circles" });
  const shipper = (s.shipper ?? "").trim();
  if (shipper && shipper.toLowerCase() !== "none" && cases > 0)
    rows.push({ label: `Shippers — ${shipper}`, value: fmtNum(cases, 0), sub: "shippers" });
  const perCase = Number(s.cartonsPerCase) || 0;
  if (perCase > 0 && pizzas > 0)
    rows.push({ label: "Cartons", value: fmtNum(Math.ceil(pizzas / perCase), 0), sub: "cases" });
  return rows;
}

export default function WarehouseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { allRuns, scheduled, brandProfiles, stagedItems, toggleStagedItem } = useRun();
  const { items: freezerPullItems } = useFreezerPullItems();

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  // Aggregate ingredient needs across active runs, preserving each row's native
  // unit (dough/sauce/cheese → batches, mixes/pepperoni → lbs) exactly like the
  // web warehouse tab (aggregateNeedRows). Never force everything to "lbs".
  const nowMs = Date.now();
  const activeRuns = allRuns.filter((r) => r.endedAt == null);
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
  let cartonCases = 0;
  for (const r of allRuns) {
    if (r.endedAt != null) continue;
    const s = r.settings;
    // Only cartoned runs contribute to packaging needs; "labeled" runs excluded.
    if ((s.cartoned ?? "").trim().toLowerCase() !== "yes") continue;
    const cases = s.casesNeeded;
    const pizzas = s.casesNeeded * s.pizzasPerCase;
    // Cartons are bought by the case: cases = total pizzas / cartons per case.
    const perCase = Number(s.cartonsPerCase) || 0;
    if (perCase > 0 && pizzas > 0) cartonCases += pizzas / perCase;
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
  if (cartonCases > 0)
    packagingRows.push({ label: "Cartons", value: fmtNum(Math.ceil(cartonCases), 0), sub: "cases" });

  const today = todayStr();
  const scheduledDays = Object.keys(scheduled)
    .filter((d) => (scheduled[d]?.length ?? 0) > 0 && d >= today)
    .sort();

  // Pull Out Freezer: scheduled runs carry no recipe rows, so resolve each via
  // its brand/flavor profile -> RunSettings -> RunCalc -> per-run need rows
  // (exactly like the per-run breakdown), then let the shared lib decide which
  // tagged freezer items are now within their pull window. Mirrors the web
  // warehouse card (replit.md parity).
  const freezerRuns = Object.entries(scheduled).flatMap(([date, runs]) =>
    (runs ?? [])
      .filter((r) => r.brand)
      .map((r) => {
        const profile = brandProfiles[profileKey(r.brand, r.flavor)] ?? {};
        const settings: RunSettings = {
          ...DEFAULT_SETTINGS,
          ...profile,
          brand: r.brand,
          flavor: r.flavor,
          casesNeeded: r.casesNeeded,
          ...(r.dieType ? { dieType: r.dieType } : {}),
        };
        const runState: RunState = {
          id: r.id,
          settings,
          progress: { ...DEFAULT_PROGRESS },
          stoppages: [],
          isRunning: false,
        };
        const c = computeCalc(runState, nowMs);
        const needRows = [
          ...buildRunNeedRows(c, settings),
          ...buildRunPackagingRows(settings),
        ];
        return {
          date,
          brand: r.brand,
          flavor: r.flavor,
          ingredients: needRows.map((row) => ({
            name: row.label,
            quantity: row.value,
            unit: row.sub,
          })),
        };
      }),
  );
  const freezerPlan = buildFreezerPullPlan({
    runs: freezerRuns,
    freezerItems: freezerPullItems,
    today,
  });

  // Reorder Now demand basis: UPCOMING (today-or-later) scheduled runs resolved
  // to RunSettings via their brand/flavor profile, exactly like the freezer-pull
  // resolution above. Web filters scheduledDays to `d >= today`, so mobile must
  // too — otherwise past scheduled runs would inflate demand and the two cards
  // would drift (replit.md parity).
  const scheduledSettingsList: RunSettings[] = scheduledDays.flatMap((date) =>
    (scheduled[date] ?? [])
      .filter((r) => r.brand)
      .map((r) => {
        const profile = brandProfiles[profileKey(r.brand, r.flavor)] ?? {};
        return {
          ...DEFAULT_SETTINGS,
          ...profile,
          brand: r.brand,
          flavor: r.flavor,
          casesNeeded: r.casesNeeded,
          ...(r.dieType ? { dieType: r.dieType } : {}),
        };
      }),
  );

  // Use First "today's runs" basis: runs active now + runs scheduled for today,
  // resolved to RunSettings exactly like the lists above. Web builds the same
  // set (active runs + today's scheduled), so the two cards prioritize the same
  // lots (replit.md parity).
  const activeSettingsList: RunSettings[] = allRuns
    .filter((r) => r.endedAt == null)
    .map((r) => r.settings);
  const todayScheduledSettingsList: RunSettings[] = (scheduled[today] ?? [])
    .filter((r) => r.brand)
    .map((r) => {
      const profile = brandProfiles[profileKey(r.brand, r.flavor)] ?? {};
      return {
        ...DEFAULT_SETTINGS,
        ...profile,
        brand: r.brand,
        flavor: r.flavor,
        casesNeeded: r.casesNeeded,
        ...(r.dieType ? { dieType: r.dieType } : {}),
      };
    });
  const todaySettingsList: RunSettings[] = [
    ...activeSettingsList,
    ...todayScheduledSettingsList,
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Pull Out Freezer: grouped by run date, only items now within their
            days-early window whose recipe uses them, with quantities. */}
        {freezerPlan.map((group) => (
          <Card
            key={`freezer-${group.date}`}
            title={`Pull Out Freezer for ${group.date === today ? "Today" : fmtDate(group.date)}`}
            icon="alert-circle"
            style={{ marginBottom: 16 }}
          >
            <Text style={[styles.freezerSubhead, { color: colors.mutedForeground }]}>
              {group.daysUntil === 0
                ? "Runs today"
                : `In ${group.daysUntil} day${group.daysUntil !== 1 ? "s" : ""}`}
            </Text>
            <View style={{ gap: 10 }}>
              {group.runs.map((run, ri) => (
                <View
                  key={ri}
                  style={[
                    styles.freezerRun,
                    { backgroundColor: colors.secondary, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.freezerRunTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {run.brand}{run.flavor ? ` — ${run.flavor}` : ""}
                  </Text>
                  <View style={styles.needList}>
                    {run.items.map((it, ii) => (
                      <View key={ii} style={styles.needRow}>
                        <Text style={[styles.needLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {it.name}
                          <Text style={[styles.freezerEarly, { color: colors.mutedForeground }]}>
                            {"  "}pull {it.daysEarly}d early
                          </Text>
                        </Text>
                        <Text style={styles.needValueWrap} numberOfLines={1}>
                          <Text style={[styles.needValue, { color: colors.foreground }]}>
                            {it.quantity}{" "}
                          </Text>
                          <Text style={[styles.needSub, { color: colors.mutedForeground }]}>
                            {it.unit}
                          </Text>
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </Card>
        ))}

        {/* Reorder Now: cross-location on-hand at/below reorder threshold once
            upcoming scheduled-run demand is subtracted. Advisory only. */}
        <ReorderCard scheduledSettingsList={scheduledSettingsList} />

        {/* Use First: stock lots expiring within the configured window (plus any
            already past), ordered first-expired-first-out, with the lots used by
            today's runs surfaced to the top. Advisory only — never writes stock. */}
        <UseFirstCard todaySettingsList={todaySettingsList} />

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

        {/* Per-run breakdown: what each active run needs and roughly how long it
            runs, so warehouse staff can stage materials run by run instead of
            reading off one combined total. Reuses the same per-run calc + need
            mapping as the roll-up above (web/mobile parity). */}
        {activeRuns.length > 0 && (
          <Card title="What Each Run Needs" icon="list" style={{ marginTop: 16 }}>
            <View style={styles.runList}>
              {activeRuns.map((r, i) => {
                const c = computeCalc(r, nowMs);
                const s = r.settings;
                const totalPizzas = s.casesNeeded * s.pizzasPerCase;
                const estSec = c.ppm > 0 ? (totalPizzas * 60) / c.ppm : 0;
                const rows = [...buildRunNeedRows(c, s), ...buildRunPackagingRows(s)];
                const stagedCount = rows.filter(
                  (row) => stagedItems[`${r.id}::${row.label}__${row.sub}`],
                ).length;
                return (
                  <View
                    key={r.id}
                    style={[
                      styles.runCard,
                      { backgroundColor: colors.secondary, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.runHeader}>
                      <Text
                        style={[styles.runTitle, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {runLabel(r, i)}
                      </Text>
                      <Text style={[styles.runMeta, { color: colors.mutedForeground }]}>
                        {rows.length > 0 ? `${stagedCount}/${rows.length} staged · ` : ""}
                        {s.casesNeeded} case{s.casesNeeded !== 1 ? "s" : ""}
                        {estSec > 0 ? ` · ~${fmtDur(estSec)}` : ""}
                      </Text>
                    </View>
                    {rows.length === 0 ? (
                      <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                        No materials configured yet.
                      </Text>
                    ) : (
                      <View style={styles.needList}>
                        {rows.map((row) => {
                          const rowKey = `${row.label}__${row.sub}`;
                          const checked = !!stagedItems[`${r.id}::${rowKey}`];
                          return (
                            <Pressable
                              key={rowKey}
                              onPress={() => toggleStagedItem(r.id, rowKey)}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked }}
                              style={[styles.needRow, { alignItems: "center", paddingVertical: 2 }]}
                            >
                              <Ionicons
                                name={checked ? "checkbox" : "square-outline"}
                                size={18}
                                color={checked ? colors.primary : colors.mutedForeground}
                                style={styles.needCheck}
                              />
                              <Text
                                style={[
                                  styles.needLabel,
                                  {
                                    color: colors.mutedForeground,
                                    textDecorationLine: checked ? "line-through" : "none",
                                  },
                                ]}
                                numberOfLines={1}
                              >
                                {row.label}
                              </Text>
                              <Text style={styles.needValueWrap} numberOfLines={1}>
                                <Text
                                  style={[
                                    styles.needValue,
                                    { color: checked ? colors.mutedForeground : colors.foreground },
                                  ]}
                                >
                                  {row.value}{" "}
                                </Text>
                                <Text style={[styles.needSub, { color: colors.mutedForeground }]}>
                                  {row.sub}
                                </Text>
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
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
  needCheck: { marginRight: 2 },
  needLabel: { fontSize: 14, flexShrink: 1, fontFamily: FONTS.regular },
  needValueWrap: { textAlign: "right", flexShrink: 0 },
  needValue: {
    fontSize: 14,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
  },
  needSub: { fontSize: 14, fontFamily: FONTS.regular },

  runList: { gap: 10 },
  runCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  runTitle: { fontSize: 15, flexShrink: 1, fontFamily: FONTS.medium },
  runMeta: {
    fontSize: 12,
    flexShrink: 0,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
  },

  freezerSubhead: { fontSize: 12, fontFamily: FONTS.regular, marginBottom: 8 },
  freezerRun: { borderRadius: 8, borderWidth: 1, padding: 12 },
  freezerRunTitle: { fontSize: 15, fontFamily: FONTS.medium, marginBottom: 8 },
  freezerEarly: { fontSize: 11, fontFamily: FONTS.regular },

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
