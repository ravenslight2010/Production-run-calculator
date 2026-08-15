import { Feather } from "@expo/vector-icons";
import { Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, SectionHeader } from "@/components/UI";
import {
  DEFAULT_SETTINGS,
  profileKey,
  todayStr,
  useRun,
} from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { useMe } from "@/hooks/useRole";
import { useMixes } from "@/hooks/useMixes";
import { buildMixPlan } from "@workspace/mixes";

function tap() {
  Haptics.selectionAsync();
}

function fmtNum(n: number, dec: number): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toFixed(dec);
}

function nextDates(count: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    out.push(
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`,
    );
  }
  return out;
}

function fmtDayShort(s: string): { weekday: string; day: string } {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return {
    weekday: dt.toLocaleDateString(undefined, { weekday: "short" }),
    day: dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

// Mixes make-day plan (mobile parity with the web Mixes tab). Pre-blended mixes
// are made ahead for a product; pick a make-day and for every scheduled run
// within a matching mix's days-early window, show per-product cards with
// cases/pizzas, batches to make, total lbs, and a "Pull For Mix" per-component
// lbs breakdown. Scheduled runs carry no recipe rows, so resolve each via its
// brand/flavor profile → RunSettings, exactly like the warehouse card. Pizzas =
// casesNeeded × pizzasPerCase, cases = casesNeeded (mirrors web
// computeSummaryStats). Advisory only — this never moves stock.
export default function MixesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { scheduled, brandProfiles } = useRun();
  const { items: mixes } = useMixes();
  const { hasCapability } = useMe();
  const canManageInventory = hasCapability("manage-inventory");

  const today = todayStr();
  const dates = useMemo(() => nextDates(14), []);
  const [makeDay, setMakeDay] = useState(today);

  const webTop = Platform.OS === "web" ? 16 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const scheduledDays = Object.keys(scheduled).sort();
  const runs = scheduledDays.flatMap((date) =>
    (scheduled[date] ?? [])
      .filter((r) => r.brand)
      .map((r) => {
        const profile = brandProfiles[profileKey(r.brand, r.flavor)] ?? {};
        const settings = {
          ...DEFAULT_SETTINGS,
          ...profile,
          brand: r.brand,
          flavor: r.flavor,
          casesNeeded: r.casesNeeded,
          ...(r.dieType ? { dieType: r.dieType } : {}),
        };
        return {
          date,
          brand: r.brand,
          flavor: r.flavor,
          pizzas: settings.casesNeeded * settings.pizzasPerCase,
          cases: settings.casesNeeded,
        };
      }),
  );

  const plan = useMemo(
    () => buildMixPlan({ runs, mixes, today: makeDay }),
    [runs, mixes, makeDay],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Mixes", headerShown: true }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: 16,
          paddingTop: webTop + 8,
          paddingBottom: insets.bottom + webBottom + 48,
          gap: 4,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Feather name="layers" size={18} color="#34d399" />
          <Text style={{ fontSize: 18, fontFamily: FONTS.bold, color: colors.foreground }}>
            Mixes
          </Text>
        </View>
        <Text style={{ fontSize: 12, fontFamily: FONTS.regular, color: colors.mutedForeground, marginBottom: 8 }}>
          Pre-blended mixes made ahead for a product. Pick a make-day to see what
          to make for the scheduled runs within each mix&apos;s days-early window.
        </Text>

        <SectionHeader title="Make Day" />
        <View style={styles.dateRow}>
          {dates.map((d) => {
            const sel = d === makeDay;
            const { weekday, day } = fmtDayShort(d);
            return (
              <Pressable
                key={d}
                onPress={() => {
                  setMakeDay(d);
                  tap();
                }}
                style={[
                  styles.dateChip,
                  {
                    backgroundColor: sel ? colors.primary : colors.card,
                    borderColor: sel ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dateWeekday,
                    { color: sel ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {d === today ? "Today" : weekday}
                </Text>
                <Text
                  style={[
                    styles.dateDay,
                    { color: sel ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: 8 }}>
          {mixes.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No mixes defined yet.
              {canManageInventory
                ? " Add mixes under Master Data → Mixes."
                : " Ask a manager to add mixes under Master Data."}
            </Text>
          ) : plan.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No mixes to make for this day. Pick a make-day with scheduled runs
              whose product matches a mix (within its days-early window).
            </Text>
          ) : (
            <View style={{ gap: 12 }}>
              {plan.map((group) => (
                <CardSection key={group.date}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <Feather name="layers" size={14} color="#34d399" />
                    <Text style={{ fontSize: 13, fontFamily: FONTS.bold, color: "#34d399", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Mixes for {group.date}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: FONTS.regular, color: colors.mutedForeground }}>
                      ({group.daysUntil === 0 ? "today" : `in ${group.daysUntil} day${group.daysUntil !== 1 ? "s" : ""}`})
                    </Text>
                  </View>

                  <View style={{ gap: 10 }}>
                    {group.runs.map((run, ri) => (
                      <View
                        key={ri}
                        style={{
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: colors.border,
                          backgroundColor: colors.secondary,
                          padding: 12,
                          gap: 8,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                          <Text style={{ flex: 1, fontSize: 14, fontFamily: FONTS.bold, color: colors.foreground }} numberOfLines={1}>
                            {run.brand}
                            {run.flavor ? ` — ${run.flavor}` : ""}
                          </Text>
                          <Text style={{ fontSize: 12, fontFamily: FONTS.mono, color: colors.mutedForeground }}>
                            {run.cases} case{run.cases !== 1 ? "s" : ""} · {run.pizzas} pizza{run.pizzas !== 1 ? "s" : ""}
                          </Text>
                        </View>

                        <View style={{ gap: 8 }}>
                          {run.mixes.map((m) => (
                            <View
                              key={m.mixId}
                              style={{
                                borderRadius: 8,
                                borderWidth: 1,
                                borderColor: colors.border,
                                backgroundColor: colors.background,
                                padding: 10,
                                gap: 6,
                              }}
                            >
                              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                <Text style={{ flex: 1, fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }} numberOfLines={1}>
                                  {m.name}
                                  {m.daysEarly > 0 ? (
                                    <Text style={{ fontSize: 11, fontFamily: FONTS.regular, color: colors.mutedForeground }}>
                                      {"  "}make {m.daysEarly}d early
                                    </Text>
                                  ) : null}
                                </Text>
                                <Text style={{ fontSize: 13, fontFamily: FONTS.bold, color: colors.foreground }}>
                                  {m.batchSize > 0 ? (
                                    <>
                                      {fmtNum(m.batches, 2)}{" "}
                                      <Text style={{ fontFamily: FONTS.regular, color: colors.mutedForeground }}>
                                        batch{m.batches === 1 ? "" : "es"}
                                      </Text>
                                    </>
                                  ) : (
                                    <Text style={{ fontSize: 11, fontFamily: FONTS.regular, color: colors.mutedForeground }}>
                                      no batch size
                                    </Text>
                                  )}
                                </Text>
                              </View>

                              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                <Text style={{ fontSize: 12, fontFamily: FONTS.mono, color: colors.mutedForeground }}>
                                  Total {fmtNum(m.totalLbs, 2)} lbs
                                </Text>
                                {m.amountAlreadyMade > 0 ? (
                                  <Text style={{ fontSize: 12, fontFamily: FONTS.mono, color: colors.mutedForeground }}>
                                    have {fmtNum(m.amountAlreadyMade, 2)} → need {fmtNum(m.remainingLbs, 2)} lbs
                                  </Text>
                                ) : null}
                              </View>

                              {m.notes ? (
                                <Text style={{ fontSize: 11, fontFamily: FONTS.regular, fontStyle: "italic", color: colors.mutedForeground }}>
                                  {m.notes}
                                </Text>
                              ) : null}

                              {m.missingAmounts ? (
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 6, borderWidth: 1, borderColor: "#92400e", backgroundColor: "#451a03", paddingHorizontal: 8, paddingVertical: 6 }}>
                                  <Feather name="alert-triangle" size={14} color="#fcd34d" />
                                  <Text style={{ flex: 1, fontSize: 11, fontFamily: FONTS.regular, color: "#fcd34d" }}>
                                    No oz/pizza amounts — open the Mixes editor to enter them
                                  </Text>
                                </View>
                              ) : null}

                              <View style={{ gap: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                                <Text style={{ fontSize: 10, fontFamily: FONTS.semibold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5, paddingTop: 4 }}>
                                  Pull For Mix
                                </Text>
                                {m.components.length === 0 ? (
                                  <Text style={{ fontSize: 12, fontFamily: FONTS.regular, color: colors.mutedForeground }}>
                                    No components defined.
                                  </Text>
                                ) : (
                                  m.components.map((c, ci) => (
                                    <View key={ci} style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                      <Text style={{ flex: 1, fontSize: 13, fontFamily: FONTS.regular, color: colors.foreground }} numberOfLines={1}>
                                        {c.ingredient}
                                      </Text>
                                      <Text style={{ fontSize: 13, fontFamily: FONTS.bold, color: colors.foreground }}>
                                        {fmtNum(c.lbs, 2)}{" "}
                                        <Text style={{ fontFamily: FONTS.regular, color: colors.mutedForeground }}>
                                          lbs
                                        </Text>
                                      </Text>
                                    </View>
                                  ))
                                )}
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                </CardSection>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  dateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    minWidth: 64,
  },
  dateWeekday: {
    fontSize: 10,
    fontFamily: FONTS.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateDay: { fontSize: 13, fontFamily: FONTS.bold, marginTop: 2 },
  empty: { fontSize: 13, fontStyle: "italic", fontFamily: FONTS.regular },
});
