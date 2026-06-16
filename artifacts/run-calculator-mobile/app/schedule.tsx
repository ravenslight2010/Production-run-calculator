import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { CardSection, SectionHeader } from "@/components/UI";
import { todayStr, useRun } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";

function tap() {
  Haptics.selectionAsync();
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

export default function ScheduleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    brands,
    brandFlavors,
    scheduled,
    addScheduledRun,
    removeScheduledRun,
    clearScheduledDay,
    applyScheduledDay,
  } = useRun();

  const today = todayStr();
  const dates = useMemo(() => nextDates(14), []);
  const [selectedDate, setSelectedDate] = useState(today);

  const [brand, setBrand] = useState("");
  const [flavor, setFlavor] = useState("");
  const [cases, setCases] = useState("");
  const [dieType, setDieType] = useState("");
  const [notes, setNotes] = useState("");

  const dayRuns = scheduled[selectedDate] ?? [];
  const flavorOptions = brand ? brandFlavors[brand] ?? [] : [];

  const canAdd = brand.trim().length > 0 && flavor.trim().length > 0;

  const add = () => {
    if (!canAdd) return;
    addScheduledRun(selectedDate, {
      brand: brand.trim(),
      flavor: flavor.trim(),
      casesNeeded: Math.max(0, parseInt(cases, 10) || 0),
      dieType: dieType.trim(),
      notes: notes.trim(),
    });
    setFlavor("");
    setCases("");
    setNotes("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const apply = () => {
    if (dayRuns.length === 0) return;
    if (applyScheduledDay(selectedDate)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    }
  };

  const webTop = Platform.OS === "web" ? 16 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <>
      <Stack.Screen options={{ title: "Production Schedule", headerShown: true }} />
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: 16,
          paddingTop: webTop + 8,
          paddingBottom: insets.bottom + webBottom + 48,
          gap: 4,
        }}
      >
        <SectionHeader title="Pick a Day" />
        <View style={styles.dateRow}>
          {dates.map((d) => {
            const sel = d === selectedDate;
            const { weekday, day } = fmtDayShort(d);
            const count = (scheduled[d] ?? []).length;
            return (
              <Pressable
                key={d}
                onPress={() => {
                  setSelectedDate(d);
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
                {count > 0 ? (
                  <View
                    style={[
                      styles.dateBadge,
                      {
                        backgroundColor: sel
                          ? colors.primaryForeground
                          : colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dateBadgeText,
                        { color: sel ? colors.primary : colors.primaryForeground },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <SectionHeader title="Planned Runs" />
        <CardSection>
          {dayRuns.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No runs planned for this day yet — add one below.
            </Text>
          ) : (
            dayRuns.map((r) => (
              <View
                key={r.id}
                style={[styles.planRow, { borderColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planTitle, { color: colors.foreground }]}>
                    {r.brand} · {r.flavor}
                  </Text>
                  <Text style={[styles.planMeta, { color: colors.mutedForeground }]}>
                    {r.casesNeeded > 0 ? `${r.casesNeeded} cases` : "No case target"}
                    {r.dieType ? ` · ${r.dieType}` : ""}
                  </Text>
                  {r.notes ? (
                    <Text
                      style={[styles.planNotes, { color: colors.mutedForeground }]}
                    >
                      {r.notes}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    removeScheduledRun(selectedDate, r.id);
                    tap();
                  }}
                  hitSlop={8}
                  style={styles.planDelBtn}
                >
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ))
          )}
        </CardSection>

        {dayRuns.length > 0 ? (
          <View style={styles.actionRow}>
            <Pressable
              onPress={apply}
              style={({ pressed }) => [
                styles.applyBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="play" size={15} color={colors.primaryForeground} />
              <Text style={[styles.applyText, { color: colors.primaryForeground }]}>
                Load into today&apos;s runs
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                clearScheduledDay(selectedDate);
                tap();
              }}
              style={({ pressed }) => [
                styles.clearBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Feather name="x" size={15} color={colors.foreground} />
            </Pressable>
          </View>
        ) : null}

        <SectionHeader title="Add a Planned Run" />
        <CardSection>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            Brand
          </Text>
          <View style={styles.optionWrap}>
            {brands.map((b) => (
              <Pressable
                key={b}
                onPress={() => {
                  setBrand(b);
                  setFlavor("");
                  tap();
                }}
                style={[
                  styles.optionChip,
                  {
                    borderColor: brand === b ? colors.primary : colors.border,
                    backgroundColor:
                      brand === b ? colors.primary + "22" : colors.secondary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    { color: brand === b ? colors.primary : colors.foreground },
                  ]}
                >
                  {b}
                </Text>
              </Pressable>
            ))}
          </View>

          {brand ? (
            <>
              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.mutedForeground, marginTop: 12 },
                ]}
              >
                Flavor
              </Text>
              {flavorOptions.length > 0 ? (
                <View style={styles.optionWrap}>
                  {flavorOptions.map((f) => (
                    <Pressable
                      key={f}
                      onPress={() => {
                        setFlavor(f);
                        tap();
                      }}
                      style={[
                        styles.optionChip,
                        {
                          borderColor: flavor === f ? colors.primary : colors.border,
                          backgroundColor:
                            flavor === f ? colors.primary + "22" : colors.secondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          { color: flavor === f ? colors.primary : colors.foreground },
                        ]}
                      >
                        {f}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                  No saved flavors — type one below.
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border, marginTop: 8 },
                ]}
                value={flavor}
                onChangeText={setFlavor}
                placeholder="Flavor"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
              />
            </>
          ) : null}

          <View style={styles.inlineRow}>
            <TextInput
              style={[
                styles.input,
                { flex: 1, color: colors.foreground, borderColor: colors.border },
              ]}
              value={cases}
              onChangeText={setCases}
              placeholder="Cases needed"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
            />
            <TextInput
              style={[
                styles.input,
                { flex: 1, color: colors.foreground, borderColor: colors.border },
              ]}
              value={dieType}
              onChangeText={setDieType}
              placeholder="Die type (optional)"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
            />
          </View>
          <TextInput
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border, marginTop: 8 },
            ]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.mutedForeground}
          />

          <Pressable
            onPress={add}
            disabled={!canAdd}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: colors.primary,
                opacity: !canAdd ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
            <Text style={[styles.addText, { color: colors.primaryForeground }]}>
              Add to {selectedDate === today ? "today" : fmtDayShort(selectedDate).day}
            </Text>
          </Pressable>
        </CardSection>
      </KeyboardAwareScrollViewCompat>
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
  dateBadge: {
    marginTop: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  dateBadgeText: { fontSize: 10, fontFamily: FONTS.bold },

  empty: { fontSize: 13, fontStyle: "italic" },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  planTitle: { fontSize: 14, fontFamily: FONTS.bold },
  planMeta: { fontSize: 12, marginTop: 2 },
  planNotes: { fontSize: 12, marginTop: 2, fontStyle: "italic" },
  planDelBtn: { padding: 6 },

  actionRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 4 },
  applyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
  },
  applyText: { fontSize: 14, fontFamily: FONTS.bold },
  clearBtn: {
    width: 46,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  fieldLabel: { fontSize: 12, fontFamily: FONTS.semibold },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  optionChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  optionText: { fontSize: 13, fontFamily: FONTS.medium },
  inlineRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 14,
  },
  addText: { fontSize: 14, fontFamily: FONTS.bold },
});
